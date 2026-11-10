// ARU-129 AC 6: the real StoreProvider against a fake Supabase client. A new meeting is inserted without a topic
// (the column default "Meeting" applies), and an edit sends the stored topic back unchanged as `new_topic`.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  inserts: [] as Record<string, unknown>[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
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
      rpc: (name: string, args: Record<string, unknown>) => {
        mockState.rpcs.push({ name, args });
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
  return <Text>{store.meetings.length}</Text>;
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
  mockState.inserts = [];
  mockState.rpcs = [];
});

it('addMeeting sends no topic, so the database default "Meeting" is stored', async () => {
  await mount();
  await act(() => store.addMeeting({ id: 'new', courseId: 'A', startsAt: '2099-01-02T10:00:00.000Z', location: ' Room 1 ' }));
  expect(mockState.inserts).toEqual([
    { table: 'course_meetings', id: 'new', course_id: 'A', starts_at: '2099-01-02T10:00:00.000Z', location: 'Room 1', created_by: 'M' },
  ]);
  expect(mockState.inserts[0]).not.toHaveProperty('topic');
});

it('updateMeeting passes the given (stored) topic through as new_topic', async () => {
  await mount();
  await act(() => store.updateMeeting('m1', { startsAt: '2099-01-02T10:00:00.000Z', topic: 'Algebra', location: '' }));
  expect(mockState.rpcs.filter((r) => r.name === 'update_meeting')).toEqual([
    {
      name: 'update_meeting',
      args: { meeting: 'm1', new_starts_at: '2099-01-02T10:00:00.000Z', new_topic: 'Algebra', new_location: '' },
    },
  ]);
});
