// ARU-85 AC 8 / AC 9: deleteCourse() in the real StoreProvider against a fake Supabase client. Photos first (and
// checked), then delete_course(); "Course not found" (P0002) counts as done.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Res = { data: unknown; error: null | { message: string; code?: string } };
const mockState = {
  role: 'teacher',
  calls: [] as string[],
  /** Answers for course_homework_photos, one per call (the last one repeats). */
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
        if (name === 'course_homework_photos') {
          mockState.calls.push(`photos ${args.course}`);
          const next = mockState.photos.length > 1 ? mockState.photos.shift()! : mockState.photos[0];
          return Promise.resolve(next ?? { data: [], error: null });
        }
        if (name === 'delete_course') {
          mockState.calls.push(`delete ${args.course}`);
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
const notFound: Res = { data: null, error: { message: 'Course not found.', code: 'P0002' } };

beforeEach(() => {
  mockState.role = 'teacher';
  mockState.calls = [];
  mockState.photos = [photos()];
  mockState.remove = { data: [], error: null };
  mockState.del = { data: null, error: null };
});

it('removes the photos, checks none is left, then deletes the course', async () => {
  mockState.photos = [photos('S1/a.jpg', 'S2/b.jpg'), photos()];
  await mount();
  await act(() => store.deleteCourse('A'));
  expect(mockState.calls).toEqual(['photos A', 'remove homework S1/a.jpg,S2/b.jpg', 'photos A', 'delete A']);
});

it('a course without photos goes straight to delete_course()', async () => {
  await mount();
  await act(() => store.deleteCourse('A'));
  expect(mockState.calls).toEqual(['photos A', 'delete A']);
});

it('a failed photo removal stops before anything is deleted', async () => {
  mockState.photos = [photos('S1/a.jpg')];
  mockState.remove = { data: null, error: { message: 'Network request failed' } };
  await mount();
  await act(async () => {
    await expect(store.deleteCourse('A')).rejects.toThrow('Network request failed');
  });
  expect(mockState.calls).not.toContain('delete A');
});

it('a photo Storage silently skipped is an error and the course is not deleted', async () => {
  mockState.photos = [photos('S1/a.jpg', 'S2/b.jpg'), photos('S2/b.jpg')];
  await mount();
  await act(async () => {
    await expect(store.deleteCourse('A')).rejects.toThrow("Some homework photos couldn't be deleted");
  });
  expect(mockState.calls).not.toContain('delete A');
});

it('a failed delete_course() is an error (photos are already gone; a retry finishes)', async () => {
  mockState.del = { data: null, error: { message: 'Network request failed' } };
  await mount();
  await act(async () => {
    await expect(store.deleteCourse('A')).rejects.toThrow('Network request failed');
  });
  mockState.del = { data: null, error: null };
  await act(() => store.deleteCourse('A'));
  expect(mockState.calls.filter((c) => c === 'delete A')).toHaveLength(2);
});

it('"Course not found" on a retry counts as done, at either step', async () => {
  mockState.photos = [notFound];
  await mount();
  await act(() => store.deleteCourse('A'));
  expect(mockState.calls).toEqual(['photos A']);

  mockState.calls = [];
  mockState.photos = [photos()];
  mockState.del = notFound;
  await act(() => store.deleteCourse('A'));
  expect(mockState.calls).toEqual(['photos A', 'delete A']);
});

it('offline: the error of the first request shows and nothing is deleted', async () => {
  mockState.photos = [{ data: null, error: { message: 'Network request failed' } }];
  await mount();
  await act(async () => {
    await expect(store.deleteCourse('A')).rejects.toThrow('Network request failed');
  });
  expect(mockState.calls).toEqual(['photos A']);
});

it('a mentor is refused without a request', async () => {
  mockState.role = 'mentor';
  await mount();
  await expect(store.deleteCourse('A')).rejects.toThrow('Only a teacher can do this.');
  expect(mockState.calls).toEqual([]);
});
