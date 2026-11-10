// ARU-130: the real StoreProvider against a fake Supabase client. The "Homework sent" counts load in load() with one
// request for every loaded course (AC 5), become a map by assignment id, and are empty when the request fails, so
// the tiles hide the line instead of showing a wrong number (AC 6).
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  me: 'approved' as 'approved' | 'pending',
  courses: [] as Record<string, unknown>[],
  rpcs: [] as { name: string; args: unknown }[],
  counts: [] as Record<string, unknown>[],
  countsError: null as null | { message: string },
  countsThrow: false,
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'delete', 'update', 'eq', 'limit', 'lt', 'or', 'in', 'order']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'profiles') {
        return resolve({
          data: [{ id: 'S1', full_name: 'Student Sam', role: 'student', access_status: mockState.me }],
          error: null,
        });
      }
      return resolve({ data: table === 'courses' ? mockState.courses : [], error: null });
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
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        mockState.rpcs.push({ name, args });
        if (name === 'assignment_sent_counts') {
          if (mockState.countsThrow) return Promise.reject(new Error('Network request failed'));
          return Promise.resolve(
            mockState.countsError ? { data: null, error: mockState.countsError } : { data: mockState.counts, error: null },
          );
        }
        return ok([]);
      },
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

const course = (id: string) => ({ id, title: id, created_by: 'M', created_at: '2026-11-01T00:00:00Z' });
const countCalls = () => mockState.rpcs.filter((r) => r.name === 'assignment_sent_counts');

beforeEach(() => {
  mockState.me = 'approved';
  mockState.courses = [course('A'), course('B')];
  mockState.rpcs = [];
  mockState.counts = [];
  mockState.countsError = null;
  mockState.countsThrow = false;
});

it('AC 4-5: one request for every loaded course, mapped by assignment id (string counts too)', async () => {
  mockState.counts = [
    { assignment_id: 'a1', sent: 5, listeners: 8 },
    { assignment_id: 'a2', sent: '0', listeners: '8' },
  ];
  await mount();
  expect(countCalls()).toEqual([{ name: 'assignment_sent_counts', args: { courses: ['A', 'B'] } }]);
  expect(store.assignmentSentCounts).toEqual({ a1: { sent: 5, listeners: 8 }, a2: { sent: 0, listeners: 8 } });
});

it('AC 5: pull to refresh loads the counts again', async () => {
  mockState.counts = [{ assignment_id: 'a1', sent: 1, listeners: 3 }];
  await mount();
  mockState.counts = [{ assignment_id: 'a1', sent: 2, listeners: 3 }];
  await act(async () => store.refresh());
  expect(countCalls()).toHaveLength(2);
  expect(store.assignmentSentCounts.a1).toEqual({ sent: 2, listeners: 3 });
});

it('AC 6: an error from the request leaves no counts (the lines hide)', async () => {
  mockState.countsError = { message: 'function assignment_sent_counts does not exist' };
  await mount();
  expect(store.assignmentSentCounts).toEqual({});
});

it('AC 6: offline (the request rejects): no counts, and the rest still loads', async () => {
  mockState.countsThrow = true;
  await mount();
  expect(store.assignmentSentCounts).toEqual({});
  expect(store.currentUser?.name).toBe('Student Sam');
});

it('AC 6: counts that loaded before are dropped when a later request fails, never left stale', async () => {
  mockState.counts = [{ assignment_id: 'a1', sent: 1, listeners: 3 }];
  await mount();
  mockState.countsError = { message: 'Network request failed' };
  await act(async () => store.refresh());
  expect(store.assignmentSentCounts).toEqual({});
});

it('no courses: no request, no counts', async () => {
  mockState.courses = [];
  await mount();
  expect(countCalls()).toHaveLength(0);
  expect(store.assignmentSentCounts).toEqual({});
});

it('an account waiting for approval makes no request', async () => {
  mockState.me = 'pending';
  await mount();
  expect(countCalls()).toHaveLength(0);
  expect(store.assignmentSentCounts).toEqual({});
});
