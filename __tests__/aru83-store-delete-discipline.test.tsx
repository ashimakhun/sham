// ARU-83 AC 8 / AC 9: deleteDiscipline() in the real StoreProvider against a fake Supabase client. The same steps
// as deleteCourse (ARU-85): photos first (and checked), then delete_discipline(); P0002 counts as done.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Res = { data: unknown; error: null | { message: string; code?: string } };
const mockState = {
  role: 'teacher',
  calls: [] as string[],
  photos: [] as Res[],
  remove: { data: [], error: null } as Res,
  del: { data: null, error: null } as Res,
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'insert', 'delete', 'limit', 'lt', 'or', 'in', 'eq', 'update']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({
        data: table === 'profiles' ? [{ id: 'T', full_name: 'Teacher Tess', role: mockState.role, access_status: 'approved' }] : [],
        error: null,
      });
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'T' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === 'discipline_homework_photos') {
          mockState.calls.push(`photos ${args.discipline}`);
          const next = mockState.photos.length > 1 ? mockState.photos.shift()! : mockState.photos[0];
          return Promise.resolve(next ?? { data: [], error: null });
        }
        if (name === 'delete_discipline') {
          mockState.calls.push(`delete ${args.discipline}`);
          return Promise.resolve(mockState.del);
        }
        return ok([]);
      },
      channel: () => c,
      removeChannel: () => {},
      storage: {
        from: (bucket: string) => ({
          createSignedUrls: () => ok([]),
          remove: (paths: string[]) => {
            mockState.calls.push(`remove ${bucket} ${paths.join(',')}`);
            return Promise.resolve(mockState.remove);
          },
        }),
      },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.currentUser?.name}</Text>;
}

async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await act(async () => {});
  await act(async () => {});
}

const photos = (...paths: string[]): Res => ({ data: paths.map((photo_path) => ({ photo_path })), error: null });
const notFound: Res = { data: null, error: { message: 'Discipline not found.', code: 'P0002' } };

beforeEach(() => {
  mockState.role = 'teacher';
  mockState.calls = [];
  mockState.photos = [photos()];
  mockState.remove = { data: [], error: null };
  mockState.del = { data: null, error: null };
});

it('removes all photos of its courses, checks none is left, then deletes the discipline', async () => {
  mockState.photos = [photos('S1/a.jpg', 'S2/b.jpg'), photos()];
  await mount();
  await act(() => store.deleteDiscipline('D1'));
  expect(mockState.calls).toEqual(['photos D1', 'remove homework S1/a.jpg,S2/b.jpg', 'photos D1', 'delete D1']);
});

it('a failed photo removal stops before anything is deleted; a retry works', async () => {
  mockState.photos = [photos('S1/a.jpg')];
  mockState.remove = { data: null, error: { message: 'Network request failed' } };
  await mount();
  await act(async () => {
    await expect(store.deleteDiscipline('D1')).rejects.toThrow('Network request failed');
  });
  expect(mockState.calls).not.toContain('delete D1');
  mockState.remove = { data: [], error: null };
  mockState.photos = [photos('S1/a.jpg'), photos()];
  await act(() => store.deleteDiscipline('D1'));
  expect(mockState.calls.at(-1)).toBe('delete D1');
});

it('a photo Storage skipped is an error and nothing is deleted', async () => {
  mockState.photos = [photos('S1/a.jpg'), photos('S1/a.jpg')];
  await mount();
  await act(async () => {
    await expect(store.deleteDiscipline('D1')).rejects.toThrow(
      "Some homework photos couldn't be deleted, so the discipline wasn't deleted. Try again.",
    );
  });
  expect(mockState.calls).not.toContain('delete D1');
});

it('a failed delete_discipline() is an error', async () => {
  mockState.del = { data: null, error: { message: 'Network request failed' } };
  await mount();
  await act(async () => {
    await expect(store.deleteDiscipline('D1')).rejects.toThrow('Network request failed');
  });
});

it('"Discipline not found" on a retry counts as done', async () => {
  mockState.photos = [notFound];
  await mount();
  await act(() => store.deleteDiscipline('D1'));
  expect(mockState.calls).toEqual(['photos D1']);
  mockState.calls = [];
  mockState.photos = [photos()];
  mockState.del = notFound;
  await act(() => store.deleteDiscipline('D1'));
  expect(mockState.calls).toEqual(['photos D1', 'delete D1']);
});

it('a mentor is refused without a request', async () => {
  mockState.role = 'mentor';
  await mount();
  await expect(store.deleteDiscipline('D1')).rejects.toThrow('Only a teacher can do this.');
  expect(mockState.calls).toEqual([]);
});
