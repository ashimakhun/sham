// ARU-43: the real StoreProvider against a fake Supabase client. A waiting account is the current user but never one
// of `users` (so pickers don't offer it), it opens no realtime channel and loads no unread counts; the teacher gets
// the requests list and accepts through set_access_status().
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  me: 'P',
  profiles: [] as Record<string, unknown>[],
  rpcs: [] as { name: string; args: unknown }[],
  channels: 0,
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === 'profiles' ? mockState.profiles : [], error: null });
    return q;
  };
  const channel = () => {
    mockState.channels++;
    const c: Record<string, unknown> = {};
    c.on = () => c;
    c.subscribe = () => c;
    return c;
  };
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: mockState.me } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        mockState.rpcs.push({ name, args });
        if (name === 'access_requests') {
          return ok([{ id: 'P', full_name: 'Pending Pat', email: 'p@x.test', created_at: '2026-10-30T10:00:00Z', access_status: 'pending' }]);
        }
        return ok([]);
      },
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.users.length}</Text>;
}
const profile = (id: string, role: string, access_status?: string) => ({ id, full_name: id, role, access_status });

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
  mockState.rpcs = [];
  mockState.channels = 0;
});

it('a pending account: current user, no users, no live channel, no unread counts', async () => {
  mockState.me = 'P';
  mockState.profiles = [profile('P', 'student', 'pending')];
  await mount();
  expect(store.currentUser?.accessStatus).toBe('pending');
  expect(store.users).toEqual([]);
  expect(store.dataLoaded).toBe(true);
  expect(mockState.channels).toBe(0);
  expect(mockState.rpcs.map((r) => r.name)).toEqual([]);
});

it('the teacher: pending accounts are not users, requests are loaded, Accept calls set_access_status', async () => {
  mockState.me = 'T';
  mockState.profiles = [profile('T', 'teacher', 'approved'), profile('S', 'student', 'approved'), profile('P', 'student', 'pending')];
  await mount();
  expect(store.users.map((u) => u.id)).toEqual(['T', 'S']);
  expect(store.getUser('P')).toBeUndefined();
  expect(store.accessRequests).toEqual([
    { id: 'P', name: 'Pending Pat', email: 'p@x.test', createdAt: '2026-10-30T10:00:00Z', status: 'pending' },
  ]);
  expect(mockState.channels).toBe(1);
  await act(() => store.setAccessStatus('P', 'approved'));
  expect(mockState.rpcs).toContainEqual({ name: 'set_access_status', args: { target: 'P', new_status: 'approved' } });
});

it('before the migration (no access_status column) everyone counts as approved', async () => {
  mockState.me = 'S';
  mockState.profiles = [profile('S', 'student'), profile('M', 'mentor')];
  await mount();
  expect(store.currentUser?.accessStatus).toBe('approved');
  expect(store.users).toHaveLength(2);
  expect(store.accessRequests).toEqual([]);
  expect(mockState.rpcs.map((r) => r.name)).toEqual(['chat_unread_counts', 'general_chat_unread_count']); // + ARU-72
});
