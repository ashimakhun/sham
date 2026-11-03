// QA ARU-52: the real StoreProvider against a fake Supabase client. A like sends only the post id (the database
// fills in the user and the time), a duplicate like (23505, an earlier tap already saved it) is a success, removing a
// like that's already gone is a success, and a real failure (the post was just deleted, 23503) is an error.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  likes: [] as Record<string, unknown>[],
  writes: [] as { table: string; op: string; row?: Record<string, unknown>; eq: [string, unknown][] }[],
  insertError: null as null | { code: string; message: string },
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    let write: { table: string; op: string; row?: Record<string, unknown>; eq: [string, unknown][] } | null = null;
    const eqs: [string, unknown][] = [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.eq = (col: string, v: unknown) => {
      eqs.push([col, v]);
      return q;
    };
    q.insert = (row: Record<string, unknown>) => {
      write = { table, op: 'insert', row, eq: eqs };
      return q;
    };
    q.delete = () => {
      write = { table, op: 'delete', eq: eqs };
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (write) {
        mockState.writes.push(write);
        if (write.op === 'insert' && mockState.insertError) return resolve({ data: null, error: mockState.insertError });
        return resolve({ data: null, error: null });
      }
      if (table === 'profiles')
        return resolve({
          data: [
            { id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' },
            { id: 'M', full_name: 'Mentor Max', role: 'mentor', access_status: 'approved' },
          ],
          error: null,
        });
      if (table === 'material_likes') return resolve({ data: mockState.likes, error: null });
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
        getSession: () => ok({ session: { user: { id: 'S1' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: () => ok([]),
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ remove: () => ok([]), createSignedUrls: () => ok([]) }) },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.materialLikes.length}</Text>;
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

beforeEach(() => {
  mockState.likes = [
    { material_id: 'p1', user_id: 'M', created_at: '2026-11-01T10:00:00.000Z' },
    { material_id: 'p1', user_id: 'S1', created_at: '2026-11-01T11:00:00.000Z' },
  ];
  mockState.writes = [];
  mockState.insertError = null;
});

it('loads likes with their post, user and time', async () => {
  await mount();
  expect(store.materialLikes).toEqual([
    { materialId: 'p1', userId: 'M', createdAt: '2026-11-01T10:00:00.000Z' },
    { materialId: 'p1', userId: 'S1', createdAt: '2026-11-01T11:00:00.000Z' },
  ]);
});

it('a like sends only the post id: the database sets the user and the time', async () => {
  await mount();
  await act(() => store.likeMaterial('p2'));
  expect(mockState.writes).toEqual([{ table: 'material_likes', op: 'insert', row: { material_id: 'p2' }, eq: [] }]);
});

it('a duplicate like (an earlier tap already saved it) is a success', async () => {
  await mount();
  mockState.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "material_likes_pkey"' };
  await expect(act(() => store.likeMaterial('p1'))).resolves.toBeUndefined();
});

it('liking a post that was just deleted is an error', async () => {
  await mount();
  mockState.insertError = { code: '23503', message: 'insert or update on table "material_likes" violates foreign key constraint' };
  await expect(store.likeMaterial('gone')).rejects.toThrow();
});

it('unlike removes only my own like of that post, and a like already gone is fine', async () => {
  await mount();
  await act(() => store.unlikeMaterial('p1'));
  mockState.likes = [];
  await act(() => store.unlikeMaterial('p1'));
  expect(mockState.writes).toEqual([
    { table: 'material_likes', op: 'delete', eq: [['material_id', 'p1'], ['user_id', 'S1']] },
    { table: 'material_likes', op: 'delete', eq: [['material_id', 'p1'], ['user_id', 'S1']] },
  ]);
});
