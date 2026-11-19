// ARU-162: the real StoreProvider against a fake Supabase client. My blocks load with the data; Blog posts and
// meeting notes of blocked people are left out; blocking saves with "on conflict do nothing" and hides at once;
// unblocking deletes my row and reloads.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Call = { table: string; op: string; filters: string[]; body?: unknown; options?: unknown };
const mockState = {
  blocks: [] as { blocked_id: string }[],
  blocksError: null as null | { message: string },
  calls: [] as Call[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const call: Call = { table, op: 'select', filters: [] };
    const q: Record<string, unknown> = {};
    for (const m of ['insert', 'update', 'limit', 'lt', 'in', 'order', 'or']) q[m] = () => q;
    q.select = () => q;
    q.upsert = (body: unknown, options: unknown) => {
      Object.assign(call, { op: 'upsert', body, options });
      return q;
    };
    q.delete = () => {
      call.op = 'delete';
      return q;
    };
    q.eq = (col: string, v: string) => {
      call.filters.push(`${col}=${v}`);
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      mockState.calls.push(call);
      if (table === 'profiles') {
        return resolve({
          data: [
            { id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' },
            { id: 'S2', full_name: 'Student Sue', role: 'student', access_status: 'approved' },
            { id: 'M', full_name: 'Mentor Max', role: 'mentor', access_status: 'approved' },
          ],
          error: null,
        });
      }
      if (table === 'user_blocks' && call.op === 'select') {
        return resolve(mockState.blocksError ? { data: null, error: mockState.blocksError } : { data: mockState.blocks, error: null });
      }
      if (table === 'materials') {
        return resolve({
          data: [
            { id: 'b1', teacher_id: 'M', title: 'Max post', body: '', created_at: '2026-11-01T10:00:00Z' },
            { id: 'b2', teacher_id: 'S2', title: 'Sue post', body: '', created_at: '2026-11-02T10:00:00Z' },
          ],
          error: null,
        });
      }
      if (table === 'meeting_listener_notes') {
        return resolve({
          data: [
            { id: 'n1', meeting_id: 'mt', course_id: 'A', author_id: 'S2', body: 'Sue', is_public: true, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' },
            { id: 'n2', meeting_id: 'mt', course_id: 'A', author_id: null, body: 'Gone', is_public: true, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' },
          ],
          error: null,
        });
      }
      return resolve({ data: [], error: null });
    };
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'S1' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: () => ok({ user: { id: 'S1' } }),
      },
      from: (table: string) => query(table),
      rpc: () => ok(null),
      channel: () => c,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
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

beforeEach(() => {
  mockState.blocks = [];
  mockState.blocksError = null;
  mockState.calls = [];
});

it('loads my blocks and leaves blocked people\'s Blog posts and notes out (a deleted author\'s notes stay)', async () => {
  mockState.blocks = [{ blocked_id: 'S2' }];
  await mount();
  expect(store.blockedUserIds).toEqual(['S2']);
  expect(store.isBlocked('S2')).toBe(true);
  expect(store.isBlocked(null)).toBe(false);
  expect(store.materials.map((m) => m.id)).toEqual(['b1']);
  expect(store.meetingListenerNotes.map((n) => n.id)).toEqual(['n2']);
});

it('blocking saves my row (a repeat does nothing) and hides at once', async () => {
  await mount();
  expect(store.materials).toHaveLength(2);
  await act(async () => store.blockUser('S2'));
  const upsert = mockState.calls.find((c) => c.table === 'user_blocks' && c.op === 'upsert');
  expect(upsert?.body).toEqual({ blocker_id: 'S1', blocked_id: 'S2' });
  expect(upsert?.options).toEqual({ onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
  expect(store.materials.map((m) => m.id)).toEqual(['b1']);
  expect(store.blockedUserIds).toEqual(['S2']);
});

it('unblocking deletes only my row for that person', async () => {
  mockState.blocks = [{ blocked_id: 'S2' }];
  await mount();
  mockState.blocks = [];
  await act(async () => store.unblockUser('S2'));
  const del = mockState.calls.find((c) => c.table === 'user_blocks' && c.op === 'delete');
  expect(del?.filters).toEqual(['blocker_id=S1', 'blocked_id=S2']);
  expect(store.blockedUserIds).toEqual([]);
  expect(store.materials).toHaveLength(2);
});

it('a failed load of my blocks keeps the last known ones', async () => {
  mockState.blocks = [{ blocked_id: 'S2' }];
  await mount();
  mockState.blocksError = { message: 'offline' };
  await act(async () => store.refresh());
  expect(store.blockedUserIds).toEqual(['S2']);
});
