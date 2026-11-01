// ARU-40: the real StoreProvider against a fake Supabase client. A new course is inserted with `hidden`, a loaded
// course keeps its `hidden` flag, and a reload that no longer returns a course (listener removed) drops it.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  courses: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    let insert: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'delete', 'update', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.insert = (row: Record<string, unknown>) => {
      insert = row;
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (insert) {
        mockState.inserts.push({ table, ...insert });
        return resolve({ data: null, error: null });
      }
      if (table === 'profiles') return resolve({ data: [{ id: 'M', full_name: 'Mentor Max', role: 'mentor' }], error: null });
      if (table === 'courses') return resolve({ data: mockState.courses, error: null });
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
        getSession: () => ok({ session: { user: { id: 'M' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: () => ok([]),
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.courses.length}</Text>;
}
const row = (id: string, hidden: boolean) => ({
  id,
  title: id,
  description: '',
  created_by: 'M',
  created_at: '2026-10-01T10:00:00.000Z',
  hidden,
});

async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  mockState.courses = [row('H', true), row('V', false)];
  mockState.inserts = [];
});

it('loads the hidden flag of each course', async () => {
  await mount();
  expect(store.getCourse('H')?.hidden).toBe(true);
  expect(store.getCourse('V')?.hidden).toBe(false);
});

it.each([true, false])('addCourse sends hidden = %s', async (hidden) => {
  await mount();
  await act(() => store.addCourse({ id: 'new', title: ' New ', description: '', hidden }));
  expect(mockState.inserts).toEqual([
    { table: 'courses', id: 'new', title: 'New', description: '', created_by: 'M', hidden },
  ]);
});

it('a reload that no longer returns the hidden course drops it (listener removed, AC 8)', async () => {
  await mount();
  expect(store.getCourse('H')).toBeTruthy();
  mockState.courses = [row('V', false)];
  await act(() => store.refresh());
  expect(store.getCourse('H')).toBeUndefined();
});
