// ARU-105 AC 7 / AC 10: the real StoreProvider against a fake Supabase client, for the homework photo upload order:
// a leftover at <uid>/<id>.jpg is removed before every upload, a failed save removes the uploaded photo, "already
// exists" is a failed send (never success), and a bucket refusal shows "The photo must be up to 10 MB.".
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { homeworkPhotoUploadError, StoreProvider, useStore } from '@/lib/store';

type Op = { op: string; args: unknown[] };

const mockLog: string[] = [];
const mockState = {
  savedRows: [] as string[], // homework ids that exist (an earlier attempt that saved)
  insertError: null as null | { code?: string; message: string },
  uploadError: null as null | { message: string; statusCode?: string },
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
      return Promise.resolve({ data: mockState.uploadError ? null : { path }, error: mockState.uploadError });
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
      rpc: () => ok([]),
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

const send = (photoUri: string | undefined = 'file:///prepared.jpg') =>
  store.addHomework({ id: 'h1', courseId: 'A', assignmentId: 'as1', title: 'Fractions', description: '', photoUri });

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(
    () => ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
  );
  Object.assign(mockState, {
    savedRows: [],
    insertError: null,
    uploadError: null,
    removeError: null,
    removed: [],
    uploads: [],
    inserted: null,
  });
  mockLog.length = 0;
  globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(300_000) })) as unknown as typeof fetch;
});
afterEach(() => jest.restoreAllMocks());

describe('ARU-105: sending homework with a photo', () => {
  it('AC 10 b: removes any leftover at <uid>/<id>.jpg, then uploads, then saves the homework with that path', async () => {
    await mount();
    await act(() => send());
    expect(mockLog).toEqual(expect.arrayContaining(['remove', 'upload', 'homework.insert']));
    expect(mockLog.indexOf('remove')).toBeLessThan(mockLog.indexOf('upload'));
    expect(mockLog.indexOf('upload')).toBeLessThan(mockLog.indexOf('homework.insert'));
    expect(mockState.removed).toEqual([['S1/h1.jpg']]);
    expect(mockState.uploads).toEqual(['S1/h1.jpg']);
    expect(mockState.inserted).toMatchObject({ id: 'h1', photo_path: 'S1/h1.jpg' });
  });

  it('without a photo nothing touches Storage', async () => {
    await mount();
    await act(() =>
      store.addHomework({ id: 'h1', courseId: 'A', assignmentId: 'as1', title: 'Fractions', description: '' }),
    );
    expect(mockLog).toEqual(['homework.insert']);
    expect(mockState.inserted).toMatchObject({ photo_path: null });
  });

  it('AC 10 a: a failed save removes the uploaded photo and shows the error', async () => {
    await mount();
    mockState.insertError = { code: '42501', message: 'new row violates row-level security policy' };
    await expect(send()).rejects.toThrow('new row violates row-level security policy');
    expect(mockLog.slice(-2)).toEqual(['homework.insert', 'remove']);
    expect(mockState.removed.at(-1)).toEqual(['S1/h1.jpg']);
  });

  it('AC 10 a: another homework for the assignment (23505) removes the photo and says it was already sent', async () => {
    await mount();
    mockState.insertError = { code: '23505', message: 'duplicate key value' };
    await expect(send()).rejects.toThrow('You have already sent homework for this assignment.');
    expect(mockLog.at(-1)).toBe('remove');
  });

  it('AC 10 b: if the leftover can\'t be removed (offline), the send stops before anything is uploaded or saved', async () => {
    await mount();
    mockState.removeError = { message: 'Network request failed' };
    await expect(send()).rejects.toThrow('Network request failed');
    expect(mockLog).not.toContain('upload');
    expect(mockLog).not.toContain('homework.insert');
  });

  it('AC 10 b: "already exists" after the remove is a failed send, never success', async () => {
    await mount();
    mockState.uploadError = { message: 'The resource already exists', statusCode: '409' };
    await expect(send()).rejects.toThrow('The resource already exists');
    expect(mockLog).not.toContain('homework.insert');
  });

  it('AC 7: a bucket refusal (too large or not a JPEG) shows "The photo must be up to 10 MB." and saves nothing', async () => {
    await mount();
    mockState.uploadError = { message: 'The object exceeded the maximum allowed size', statusCode: '413' };
    await expect(send()).rejects.toThrow('The photo must be up to 10 MB.');
    expect(mockLog).not.toContain('homework.insert');
  });

  it('AC 10 c: a retry after a failed save with a changed photo removes the leftover and stores one photo and one row', async () => {
    await mount();
    mockState.insertError = { code: '08006', message: 'Network request failed' };
    mockState.removeError = null;
    await expect(send('file:///first.jpg')).rejects.toThrow('Network request failed');
    mockState.insertError = null;
    mockLog.length = 0;
    await act(() => send('file:///second.jpg'));
    expect(mockLog.indexOf('remove')).toBeLessThan(mockLog.indexOf('upload'));
    expect(globalThis.fetch).toHaveBeenLastCalledWith('file:///second.jpg');
    expect(mockState.savedRows).toEqual(['h1']);
  });

  it('a retry after an earlier attempt that did save returns without uploading again', async () => {
    await mount();
    mockState.savedRows = ['h1'];
    await act(() => send());
    expect(mockLog).not.toContain('upload');
    expect(mockLog).not.toContain('remove');
  });
});

describe('homeworkPhotoUploadError', () => {
  it.each([
    [{ message: 'Payload too large', statusCode: '413' }, 'The photo must be up to 10 MB.'],
    [{ message: 'mime type image/png is not supported', statusCode: '415' }, 'The photo must be up to 10 MB.'],
    [{ message: 'The object exceeded the maximum allowed size' }, 'The photo must be up to 10 MB.'],
    [{ message: 'Network request failed' }, 'Network request failed'],
  ])('%j → %s', (error, expected) => {
    expect(homeworkPhotoUploadError(error)).toBe(expected);
  });
});
