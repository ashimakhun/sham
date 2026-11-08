// ARU-125: the real StoreProvider against a fake Supabase client. Listener notes load oldest first; saving adds the
// first entry and then changes it; deleting an entry that's already gone is fine; errors keep the server's message.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  notes: [] as Record<string, unknown>[],
  rpcs: [] as { name: string; args: unknown }[],
  rpcError: null as null | { message: string; code?: string; hint?: string },
  tables: [] as string[],
  orders: [] as string[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'delete', 'update', 'eq', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.order = (col: string) => {
      if (table === 'meeting_listener_notes') mockState.orders.push(col);
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      mockState.tables.push(table);
      if (table === 'profiles') {
        return resolve({
          data: [{ id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' }],
          error: null,
        });
      }
      return resolve({ data: table === 'meeting_listener_notes' ? mockState.notes : [], error: null });
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
        if (name.includes('listener_notes') && mockState.rpcError) {
          return Promise.resolve({ data: null, error: mockState.rpcError });
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

const row = {
  id: 'n1',
  meeting_id: 'C',
  course_id: 'A',
  author_id: 'S1',
  body: 'Mine',
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-21T10:00:00.000Z',
};
const listenerRpcs = () => mockState.rpcs.filter((r) => r.name.includes('listener_notes'));

beforeEach(() => {
  mockState.notes = [];
  mockState.rpcs = [];
  mockState.rpcError = null;
  mockState.tables = [];
  mockState.orders = [];
});

it('loads listener notes oldest first, mapped', async () => {
  mockState.notes = [row, { ...row, id: 'n2', author_id: null }];
  await mount();
  expect(mockState.orders).toEqual(['created_at', 'id']);
  expect(store.meetingListenerNotes).toEqual([
    {
      id: 'n1',
      meetingId: 'C',
      courseId: 'A',
      authorId: 'S1',
      body: 'Mine',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    expect.objectContaining({ id: 'n2', authorId: null }),
  ]);
});

it('adds the first entry, then changes it', async () => {
  await mount();
  await act(() => store.saveMyMeetingNotes('C', ' New '));
  expect(listenerRpcs()).toEqual([{ name: 'add_meeting_listener_notes', args: { meeting: 'C', new_body: ' New ' } }]);
  mockState.notes = [row];
  await act(() => store.refresh());
  mockState.rpcs = [];
  await act(() => store.saveMyMeetingNotes('C', 'Changed'));
  expect(listenerRpcs()).toEqual([{ name: 'update_meeting_listener_notes', args: { note: 'n1', new_body: 'Changed' } }]);
});

it('refuses over 10,000 characters before calling the server', async () => {
  await mount();
  await expect(store.saveMyMeetingNotes('C', 'a'.repeat(10001))).rejects.toThrow('Notes can be at most 10,000 characters.');
  expect(listenerRpcs()).toEqual([]);
});

it('shows the server message', async () => {
  await mount();
  mockState.rpcError = { message: 'You already have notes for this meeting.', code: '23505', hint: 'sham:listener_notes_exists' };
  await expect(store.saveMyMeetingNotes('C', 'x')).rejects.toThrow('You already have notes for this meeting.');
});

it('deleting notes that are already gone is fine; other refusals are errors', async () => {
  await mount();
  mockState.rpcError = { message: 'Notes not found.', code: 'P0002', hint: 'sham:listener_notes_not_found' };
  await act(() => store.deleteMeetingListenerNotes('n1'));
  expect(listenerRpcs()).toEqual([{ name: 'delete_meeting_listener_notes', args: { note: 'n1' } }]);
  mockState.rpcError = { message: "You can't delete these notes.", code: '42501', hint: 'sham:listener_notes_cant_delete' };
  await expect(store.deleteMeetingListenerNotes('n1')).rejects.toThrow("You can't delete these notes.");
});
