// ARU-107 (part a): the real StoreProvider against a fake Supabase client: the start date is loaded (AC 2),
// checkHomework no longer sends checked_at (AC 1), and requestPhotoZip asks the homework-photos-zip function for a
// link and maps every failure to the AC 9 message.
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { PHOTOS_ZIP_ERROR } from '@/lib/photoRetention';
import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  role: 'student' as 'student' | 'mentor',
  settings: { data: [{ photo_deletion_start: '2026-12-01' }], error: null } as { data: unknown; error: unknown },
  updates: [] as Record<string, unknown>[],
  invoke: null as null | (() => Promise<{ data: unknown; error: unknown }>),
  invoked: [] as [string, unknown][],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const ops: { op: string; args: unknown[] }[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in']) {
      q[m] = (...args: unknown[]) => {
        ops.push({ op: m, args });
        return q;
      };
    }
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'profiles') return resolve({ data: [{ id: 'U', full_name: 'User', role: mockState.role }], error: null });
      if (table === 'app_settings') return resolve(mockState.settings);
      if (table === 'homework' && ops.some((o) => o.op === 'update')) {
        mockState.updates.push(ops.find((o) => o.op === 'update')!.args[0] as Record<string, unknown>);
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
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'U' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: () => ok({ user: { id: 'U' } }),
      },
      from: (table: string) => query(table),
      rpc: () => ok([]),
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
      functions: {
        invoke: (name: string, options: { body: unknown }) => {
          mockState.invoked.push([name, options.body]);
          return mockState.invoke ? mockState.invoke() : ok({ url: 'https://fn/zip?token=t' });
        },
      },
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
  expect(store.currentUser?.role).toBe(mockState.role);
}

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(
    () => ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
  );
  Object.assign(mockState, {
    role: 'student',
    settings: { data: [{ photo_deletion_start: '2026-12-01' }], error: null },
    updates: [],
    invoke: null,
    invoked: [],
  });
});
afterEach(() => jest.restoreAllMocks());

it('AC 2: loads the deletion start date; before the migration (no table) it is null', async () => {
  await mount();
  expect(store.photoDeletionStart).toBe('2026-12-01');
});

it('AC 2: no table yet → null', async () => {
  mockState.settings = { data: null, error: { message: 'relation "app_settings" does not exist' } };
  await mount();
  expect(store.photoDeletionStart).toBeNull();
});

it('AC 1: checking homework sends status, checker and comment, never checked_at', async () => {
  mockState.role = 'mentor';
  await mount();
  await act(() => store.checkHomework('h1', ' Good '));
  expect(mockState.updates).toEqual([{ status: 'checked', checked_by: 'U', mentor_comment: 'Good' }]);
});

it('AC 5: asks homework-photos-zip for a link (all photos, or a course part) and returns its url', async () => {
  await mount();
  await expect(store.requestPhotoZip()).resolves.toBe('https://fn/zip?token=t');
  await expect(store.requestPhotoZip({ courseId: 'A', part: 2 })).resolves.toBe('https://fn/zip?token=t');
  expect(mockState.invoked).toEqual([
    ['homework-photos-zip', {}],
    ['homework-photos-zip', { courseId: 'A', part: 2 }],
  ]);
});

it.each([
  ['a function error', () => Promise.resolve({ data: null, error: new Error('FunctionsHttpError') })],
  ['a network failure', () => Promise.reject(new Error('Network request failed'))],
  ['no url in the answer', () => Promise.resolve({ data: { nope: 1 }, error: null })],
])('AC 9: %s → "Couldn\'t prepare your photos…"', async (_l, invoke) => {
  mockState.invoke = invoke;
  await mount();
  await expect(store.requestPhotoZip()).rejects.toThrow(PHOTOS_ZIP_ERROR);
});
