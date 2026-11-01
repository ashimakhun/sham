// ARU-30 QA: the real StoreProvider against a fake Supabase client, for the Knowledge base upload/delete logic the
// screen tests mock away. Checks the order of storage and table calls: a non-PDF or oversized file is refused before
// anything is uploaded (AC 4), an upload retry reuses the file and never saves twice, leaving mid-upload removes the
// file and saves nothing (edge case), delete removes the PDF before the row (AC 7), and Open PDF signs for 60 s (AC 5).
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Op = { op: string; args: unknown[] };

// Everything the store does against the fake client, in order: "upload", "remove", "sign" for storage, and
// "<table>.<op>" for the terminal action of each table query.
const mockLog: string[] = [];
const mockState = {
  role: 'mentor' as 'mentor' | 'student' | 'teacher',
  existingRow: false, // an earlier attempt already saved the item
  uploadError: null as null | { message: string },
  removeError: null as null | { message: string },
  deleteReturnsRow: true, // false: RLS let the delete through with 0 rows
  lastInsert: null as null | Record<string, unknown>,
  removed: [] as string[][],
  signed: [] as [string, number][],
  uploads: [] as string[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const ops: Op[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in']) {
      q[m] = (...args: unknown[]) => {
        ops.push({ op: m, args });
        return q;
      };
    }
    q.then = (resolve: (v: unknown) => unknown) => {
      const has = (o: string) => ops.some((x) => x.op === o);
      if (table === 'profiles') {
        return resolve({ data: [{ id: 'M', full_name: 'Mentor Max', role: mockState.role }], error: null });
      }
      if (table === 'material_files') {
        if (has('insert')) {
          mockLog.push('material_files.insert');
          mockState.lastInsert = ops.find((x) => x.op === 'insert')!.args[0] as Record<string, unknown>;
          return resolve({ data: null, error: null });
        }
        if (has('delete')) {
          mockLog.push('material_files.delete');
          return resolve({ data: mockState.deleteReturnsRow ? [{ id: 'f1' }] : [], error: null });
        }
        if (has('eq')) {
          mockLog.push('material_files.lookup');
          return resolve({ data: mockState.existingRow ? [{ id: 'f1' }] : [], error: null });
        }
        // The full load: one item by M, so delete can find its storage path.
        return resolve({
          data: [
            {
              id: 'f1',
              author_id: 'M',
              name: 'Book',
              description: '',
              course_id: null,
              storage_path: 'M/f1.pdf',
              size_bytes: '1024',
              created_at: '2026-10-30T10:00:00.000Z',
              updated_at: '2026-10-30T10:00:00.000Z',
            },
          ],
          error: null,
        });
      }
      return resolve({ data: [], error: null });
    };
    return q;
  };
  const channel = () => {
    const c: Record<string, unknown> = {};
    c.on = () => c;
    c.subscribe = () => c;
    return c;
  };
  const materials = {
    upload: (path: string) => {
      mockLog.push('upload');
      mockState.uploads.push(path);
      return Promise.resolve({ data: mockState.uploadError ? null : { path }, error: mockState.uploadError });
    },
    remove: (paths: string[]) => {
      mockLog.push('remove');
      mockState.removed.push(paths);
      return Promise.resolve({ data: [], error: mockState.removeError });
    },
    createSignedUrl: (path: string, expires: number) => {
      mockLog.push('sign');
      mockState.signed.push([path, expires]);
      return ok({ signedUrl: `https://signed.example/${path}` });
    },
    createSignedUrls: () => ok([]),
  };
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'M' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: () => ok([]),
      channel,
      removeChannel: () => {},
      storage: { from: () => materials },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.currentUser?.role ?? 'none'}</Text>;
}

const MB = 1024 * 1024;
let fileBytes = 1024;
const flush = () => act(async () => {});

async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  await flush();
  expect(store.currentUser?.role).toBe(mockState.role);
  mockLog.length = 0;
}

const pdf = (over: Partial<{ name: string; mimeType?: string; size?: number }> = {}) => ({
  id: 'new1',
  name: 'Algebra book',
  description: '  notes  ',
  courseId: undefined,
  file: { uri: 'file:///book.pdf', name: 'book.pdf', mimeType: 'application/pdf', size: fileBytes, ...over },
});

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(
    () => ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
  );
  Object.assign(mockState, {
    role: 'mentor',
    existingRow: false,
    uploadError: null,
    removeError: null,
    deleteReturnsRow: true,
    lastInsert: null,
    removed: [],
    signed: [],
    uploads: [],
  });
  mockLog.length = 0;
  fileBytes = 1024;
  globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(fileBytes) })) as unknown as typeof fetch;
});

describe('upload (AC 3, AC 4)', () => {
  it('saves the PDF at <uid>/<id>.pdf, then the row with the real byte size, trimmed fields and no course', async () => {
    await mount();
    await act(() => store.addMaterialFile(pdf()));
    expect(mockLog.filter((e) => e !== 'material_files.select')).toEqual(
      expect.arrayContaining(['material_files.lookup', 'upload', 'material_files.insert']),
    );
    expect(mockLog.indexOf('upload')).toBeLessThan(mockLog.indexOf('material_files.insert'));
    expect(mockState.uploads).toEqual(['M/new1.pdf']);
    expect(mockState.lastInsert).toMatchObject({
      id: 'new1',
      author_id: 'M',
      name: 'Algebra book',
      description: 'notes',
      course_id: null,
      storage_path: 'M/new1.pdf',
      size_bytes: 1024,
    });
  });

  it.each([
    ['a Word file', { name: 'book.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
    ['an image', { name: 'scan.png', mimeType: 'image/png' }],
    ['a picker size over 25 MB', { size: 25 * MB + 1 }],
  ])('AC4: %s is refused with the rule before anything is uploaded or saved', async (_l, over) => {
    await mount();
    await expect(store.addMaterialFile(pdf(over))).rejects.toThrow('The file must be a PDF up to 25 MB.');
    expect(mockLog).not.toContain('upload');
    expect(mockLog).not.toContain('material_files.insert');
  });

  it('AC4: no size from the picker, but the file read is over 25 MB → refused before upload', async () => {
    fileBytes = 25 * MB + 1;
    await mount();
    await expect(store.addMaterialFile(pdf({ size: undefined }))).rejects.toThrow('The file must be a PDF up to 25 MB.');
    expect(mockLog).not.toContain('upload');
  });

  it('AC4: exactly 25 MB is uploaded', async () => {
    fileBytes = 25 * MB;
    await mount();
    await act(() => store.addMaterialFile(pdf({ size: undefined })));
    expect(mockState.lastInsert).toMatchObject({ size_bytes: 25 * MB });
  });

  it('AC8: a student cannot upload (refused in the app before any request)', async () => {
    mockState.role = 'student';
    await mount();
    await expect(store.addMaterialFile(pdf())).rejects.toThrow();
    expect(mockLog).not.toContain('upload');
    expect(mockLog).not.toContain('material_files.insert');
  });

  it('retry: a row saved by an earlier attempt means done — no second upload or insert', async () => {
    mockState.existingRow = true;
    await mount();
    await act(() => store.addMaterialFile(pdf()));
    expect(mockLog).toContain('material_files.lookup');
    expect(mockLog).not.toContain('upload');
    expect(mockLog).not.toContain('material_files.insert');
  });

  it('retry: "already exists" from storage (file landed last time) still saves the row', async () => {
    mockState.uploadError = { message: 'The resource already exists' };
    await mount();
    await act(() => store.addMaterialFile(pdf()));
    expect(mockLog).toContain('material_files.insert');
  });

  it('AC3: any other upload error is shown and nothing is saved', async () => {
    mockState.uploadError = { message: 'Network request failed' };
    await mount();
    await expect(store.addMaterialFile(pdf())).rejects.toThrow('Network request failed');
    expect(mockLog).not.toContain('material_files.insert');
  });

  it('edge: left mid-upload ("Discard") → no row is saved and the landed file is removed', async () => {
    await mount();
    await act(() => store.addMaterialFile(pdf(), { isCancelled: () => true }));
    expect(mockLog).not.toContain('material_files.insert');
    expect(mockState.removed).toEqual([['M/new1.pdf']]);
  });
});

describe('delete (AC 7) and Open PDF (AC 5)', () => {
  it('AC7: removes the PDF first, then the row', async () => {
    await mount();
    await act(() => store.deleteMaterialFile('f1'));
    expect(mockState.removed).toEqual([['M/f1.pdf']]);
    expect(mockLog.indexOf('remove')).toBeLessThan(mockLog.indexOf('material_files.delete'));
  });

  it('AC7: if the PDF cannot be removed, the row stays (tap Delete again later)', async () => {
    mockState.removeError = { message: 'new row violates row-level security policy' };
    await mount();
    await expect(store.deleteMaterialFile('f1')).rejects.toThrow('row-level security');
    expect(mockLog).not.toContain('material_files.delete');
  });

  it('AC8: a delete RLS turns into 0 rows is reported, not silently treated as done', async () => {
    mockState.deleteReturnsRow = false;
    await mount();
    await expect(store.deleteMaterialFile('f1')).rejects.toThrow('You can no longer delete this file.');
  });

  it('AC5: Open PDF signs the path for 60 seconds, only when asked', async () => {
    await mount();
    expect(mockState.signed).toEqual([]); // not when the list loads
    const url = await store.getMaterialFileUrl('M/f1.pdf');
    expect(mockState.signed).toEqual([['M/f1.pdf', 60]]);
    expect(url).toBe('https://signed.example/M/f1.pdf');
  });
});
