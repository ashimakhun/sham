// QA ARU-143 AC 10: refreshMeetingNotes() refetches what the server lets this user read and replaces the list, so a
// note made private on another device disappears (realtime doesn't tell a client it lost access); a failed refetch
// keeps the list. is_public maps to isPublic, and a row without the column reads as private.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  notes: [] as Record<string, unknown>[],
  notesError: null as null | { message: string },
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'delete', 'update', 'eq', 'limit', 'lt', 'or', 'in', 'order']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'profiles') {
        return resolve({
          data: [{ id: 'T', full_name: 'Teacher Tess', role: 'teacher', access_status: 'approved' }],
          error: null,
        });
      }
      if (table === 'meeting_listener_notes') {
        return resolve(mockState.notesError ? { data: null, error: mockState.notesError } : { data: mockState.notes, error: null });
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
        getSession: () => ok({ session: { user: { id: 'T' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: () => ok([]),
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

const row = (id: string, isPublic?: boolean) => ({
  id,
  meeting_id: 'C',
  course_id: 'A',
  author_id: 'S1',
  body: id,
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
  ...(isPublic === undefined ? {} : { is_public: isPublic }),
});

beforeEach(() => {
  mockState.notes = [];
  mockState.notesError = null;
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

it('replaces the list: a note that became private elsewhere is gone after the refetch', async () => {
  mockState.notes = [row('a', true), row('b', true)];
  await mount();
  expect(store.meetingListenerNotes.map((n) => n.id)).toEqual(['a', 'b']);
  mockState.notes = [row('a', true)];
  await act(() => store.refreshMeetingNotes());
  expect(store.meetingListenerNotes.map((n) => n.id)).toEqual(['a']);
});

it('a failed refetch keeps the list as it was', async () => {
  mockState.notes = [row('a', true)];
  await mount();
  mockState.notesError = { message: 'Network request failed' };
  await act(() => store.refreshMeetingNotes());
  expect(store.meetingListenerNotes.map((n) => n.id)).toEqual(['a']);
});

it('maps is_public; a row without it reads as private', async () => {
  mockState.notes = [row('pub', true), row('priv', false), row('old')];
  await mount();
  expect(store.meetingListenerNotes.map((n) => [n.id, n.isPublic])).toEqual([
    ['pub', true],
    ['priv', false],
    ['old', false],
  ]);
});
