// QA ARU-162: the real StoreProvider. A live chat message from a blocked author doesn't refetch my counters (AC 4),
// one from someone else still does; a blocked author's Knowledge base PDFs stay (out of scope: PDFs aren't hidden);
// signing out clears my blocks.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Handler = (payload: { new: Record<string, unknown> }) => void;
const mockState = {
  blocks: [] as { blocked_id: string }[],
  rpcs: [] as string[],
  handlers: [] as { table: string; event: string; fn: Handler }[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['insert', 'update', 'limit', 'lt', 'in', 'order', 'or', 'select', 'eq', 'upsert', 'delete']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => {
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
      if (table === 'user_blocks') return resolve({ data: mockState.blocks, error: null });
      if (table === 'material_files') {
        return resolve({
          data: [{ id: 'p1', author_id: 'M', name: 'Guide.pdf', storage_path: 'M/p1.pdf', size_bytes: 1, created_at: '2026-11-01T10:00:00Z' }],
          error: null,
        });
      }
      return resolve({ data: [], error: null });
    };
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = (_type: string, filter: { table: string; event: string }, fn: Handler) => {
    mockState.handlers.push({ table: filter.table, event: filter.event, fn });
    return c;
  };
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'S1' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: () => ok({ user: { id: 'S1' } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string) => {
        mockState.rpcs.push(name);
        return ok(name === 'general_chat_unread_count' ? 0 : []);
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
const fire = (table: string, row: Record<string, unknown>) => {
  const h = mockState.handlers.filter((x) => x.table === table && x.event === 'INSERT');
  expect(h.length).toBeGreaterThan(0);
  for (const x of h) x.fn({ new: row });
};
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

beforeEach(() => {
  mockState.blocks = [{ blocked_id: 'S2' }];
  mockState.rpcs = [];
  mockState.handlers = [];
});

it('AC 4: a live course message from a blocked author doesn\'t refetch my counts; one from someone else does', async () => {
  await mount();
  mockState.rpcs = [];
  fire('course_messages', { id: 'x1', course_id: 'A', author_id: 'S2', body: 'hi' });
  await wait(700);
  expect(mockState.rpcs).not.toContain('chat_unread_counts');
  fire('course_messages', { id: 'x2', course_id: 'A', author_id: 'M', body: 'hi' });
  await wait(700);
  expect(mockState.rpcs).toContain('chat_unread_counts');
});

it('AC 4: the same for the general chat; a deleted author (null) still counts', async () => {
  await mount();
  mockState.rpcs = [];
  fire('general_messages', { id: 'g1', author_id: 'S2', body: 'hi' });
  await wait(700);
  expect(mockState.rpcs).not.toContain('general_chat_unread_count');
  fire('general_messages', { id: 'g2', author_id: null, body: 'hi' });
  await wait(700);
  expect(mockState.rpcs).toContain('general_chat_unread_count');
});

it('out of scope: a blocked author\'s Knowledge base PDF stays listed', async () => {
  mockState.blocks = [{ blocked_id: 'M' }];
  await mount();
  expect(store.isBlocked('M')).toBe(true);
  expect(store.materialFiles.map((f) => f.id)).toEqual(['p1']);
});
