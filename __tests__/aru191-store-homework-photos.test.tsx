// ARU-191 AC 4 / AC 5: sending homework with several photos, with the real StoreProvider against a fake Supabase
// client (as aru105-store-homework-photo.test.tsx): every photo is uploaded in order to <uid>/<id>/<n>.jpg, then one
// submit_homework() call saves the homework with all of them; a failed upload or save removes what was uploaded and
// saves nothing; a send never uploads more than 10.
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore, withPhotoLists } from '@/lib/store';
import type { Homework } from '@/lib/types';

type Op = { op: string; args: unknown[] };

const mockLog: string[] = [];
const mockState = {
  savedRows: [] as string[], // homework ids that exist (an earlier attempt that saved)
  insertError: null as null | { code?: string; message: string },
  uploadError: null as null | { message: string; statusCode?: string },
  /** The upload (1-based) that fails with uploadError; 0 = every one. */
  failUpload: 0,
  removeError: null as null | { message: string },
  removed: [] as string[][],
  uploads: [] as string[],
  inserted: null as null | Record<string, unknown>,
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
      if (table === 'profiles') return resolve({ data: [{ id: 'S1', full_name: 'Student Sam', role: 'student' }], error: null });
      if (table === 'course_members') {
        return resolve({ data: [{ course_id: 'A', user_id: 'S1', added_by: 'M', added_at: '2026-11-01T10:00:00Z' }], error: null });
      }
      if (table === 'homework' && has('insert')) {
        mockLog.push('homework.insert');
        mockState.inserted = ops.find((x) => x.op === 'insert')!.args[0] as Record<string, unknown>;
        if (!mockState.insertError) mockState.savedRows.push(String(mockState.inserted.id));
        return resolve({ data: null, error: mockState.insertError });
      }
      if (table === 'homework' && has('eq')) {
        const byId = ops.find((x) => x.op === 'eq' && x.args[0] === 'id');
        const ids = byId ? mockState.savedRows.filter((id) => id === byId.args[1]) : mockState.savedRows;
        return resolve({ data: ids.map((id) => ({ id })), error: null });
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
  const bucket = {
    upload: (path: string) => {
      mockLog.push('upload');
      mockState.uploads.push(path);
      const fails = !!mockState.uploadError && (!mockState.failUpload || mockState.uploads.length === mockState.failUpload);
      return Promise.resolve({ data: fails ? null : { path }, error: fails ? mockState.uploadError : null });
    },
    remove: (paths: string[]) => {
      mockLog.push('remove');
      mockState.removed.push(paths);
      return Promise.resolve({ data: [], error: mockState.removeError });
    },
    createSignedUrl: () => ok({ signedUrl: 'https://signed.example/x' }),
    createSignedUrls: () => ok([]),
  };
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'S1' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      // ARU-191: the homework and its photos are saved by submit_homework() (0081).
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name !== 'submit_homework') return ok([]);
        mockLog.push('homework.insert');
        mockState.inserted = args;
        if (!mockState.insertError) mockState.savedRows.push(String(args.homework_id));
        return Promise.resolve({ data: null, error: mockState.insertError });
      },
      channel,
      removeChannel: () => {},
      storage: { from: () => bucket },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.currentUser?.role ?? 'none'}</Text>;
}
const flush = () => act(async () => {});

async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  await flush();
  expect(store.currentUser?.role).toBe('student');
  mockLog.length = 0;
}

const uris = (n: number) => Array.from({ length: n }, (_, i) => `file:///p${i + 1}.jpg`);
const send = (photoUris: string[]) =>
  store.addHomework({ id: 'h1', courseId: 'A', assignmentId: 'as1', title: 'Fractions', description: '', photoUris });

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(
    () => ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
  );
  Object.assign(mockState, {
    savedRows: [],
    insertError: null,
    uploadError: null,
    failUpload: 0,
    removeError: null,
    removed: [],
    uploads: [],
    inserted: null,
  });
  mockLog.length = 0;
  globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(300_000) })) as unknown as typeof fetch;
});
afterEach(() => jest.restoreAllMocks());

describe('ARU-191: sending homework with several photos', () => {
  it('AC 4: 3 photos are uploaded in order, then saved in one call with the same order', async () => {
    await mount();
    await act(() => send(uris(3)));
    expect(mockState.uploads).toEqual(['S1/h1/1.jpg', 'S1/h1/2.jpg', 'S1/h1/3.jpg']);
    expect((globalThis.fetch as jest.Mock).mock.calls.map((c) => c[0])).toEqual(uris(3));
    expect(mockLog.filter((l) => l === 'homework.insert')).toHaveLength(1);
    expect(mockLog.lastIndexOf('upload')).toBeLessThan(mockLog.indexOf('homework.insert'));
    expect(mockState.inserted).toMatchObject({
      homework_id: 'h1',
      course_id: 'A',
      assignment_id: 'as1',
      photo_paths: ['S1/h1/1.jpg', 'S1/h1/2.jpg', 'S1/h1/3.jpg'],
    });
  });

  it('AC 5: leftovers of every possible name are removed first', async () => {
    await mount();
    await act(() => send(uris(2)));
    expect(mockLog[0]).toBe('remove');
    expect(mockState.removed[0]).toHaveLength(10);
    expect(mockState.removed[0]).toContain('S1/h1/10.jpg');
  });

  it('AC 5: a failed 2nd upload removes the 1st, saves nothing and shows the error', async () => {
    await mount();
    mockState.uploadError = { message: 'Network request failed' };
    mockState.failUpload = 2;
    await expect(send(uris(3))).rejects.toThrow('Network request failed');
    expect(mockState.uploads).toEqual(['S1/h1/1.jpg', 'S1/h1/2.jpg']);
    expect(mockLog).not.toContain('homework.insert');
    expect(mockState.removed.at(-1)).toEqual(['S1/h1/1.jpg']);
  });

  it('AC 5: a failed save removes every uploaded photo', async () => {
    await mount();
    mockState.insertError = { code: '42501', message: 'new row violates row-level security policy' };
    await expect(send(uris(4))).rejects.toThrow('new row violates row-level security policy');
    expect(mockState.removed.at(-1)).toEqual(['S1/h1/1.jpg', 'S1/h1/2.jpg', 'S1/h1/3.jpg', 'S1/h1/4.jpg']);
  });

  it('AC 5: a retry sends exactly the photos shown now', async () => {
    await mount();
    mockState.insertError = { code: '08006', message: 'Network request failed' };
    await expect(send(uris(3))).rejects.toThrow('Network request failed');
    mockState.insertError = null;
    mockState.uploads = [];
    await act(() => send(uris(2)));
    expect(mockState.uploads).toEqual(['S1/h1/1.jpg', 'S1/h1/2.jpg']);
    expect(mockState.inserted).toMatchObject({ photo_paths: ['S1/h1/1.jpg', 'S1/h1/2.jpg'] });
  });

  it('AC 12: never more than 10', async () => {
    await mount();
    await act(() => send(uris(12)));
    expect(mockState.uploads).toHaveLength(10);
    expect((mockState.inserted?.photo_paths as string[]).length).toBe(10);
  });
});

describe('withPhotoLists (AC 6, AC 8)', () => {
  const hw = (id: string, photoPath?: string): Homework =>
    ({ id, studentId: 'S1', title: id, description: '', status: 'submitted', createdAt: '', photoPath }) as Homework;

  it('the list in position order; photoPath is the first', () => {
    const [h] = withPhotoLists(
      [hw('h1', 'S1/h1/1.jpg')],
      [
        { homework_id: 'h1', path: 'S1/h1/3.jpg', position: 3 },
        { homework_id: 'h1', path: 'S1/h1/1.jpg', position: 1 },
        { homework_id: 'h1', path: 'S1/h1/2.jpg', position: 2 },
      ],
    );
    expect(h.photos?.map((p) => p.path)).toEqual(['S1/h1/1.jpg', 'S1/h1/2.jpg', 'S1/h1/3.jpg']);
    expect(h.photoPath).toBe('S1/h1/1.jpg');
  });

  it('AC 8: an old homework with only photo_path is one photo; none is none', () => {
    const [old, none] = withPhotoLists([hw('old', 'S1/old.jpg'), hw('none')], []);
    expect(old.photos).toEqual([{ path: 'S1/old.jpg' }]);
    expect(none.photos).toEqual([]);
  });
});
