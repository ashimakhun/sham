// ARU-157: only the latest load()'s answer is used. An older reload finishing after a newer one doesn't overwrite it,
// and a reload finishing after sign-out (or a switch of user) doesn't bring the previous user's data back.
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Row = Record<string, unknown>;
type Session = { user: { id: string } } | null;

// Every homework fetch waits until the test answers it, so the test decides the order answers arrive in.
const mockState = {
  me: 'M',
  pending: [] as ((rows: Row[]) => void)[],
  authHandler: null as null | ((event: string, s: Session) => void),
  calls: [] as string[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      mockState.calls.push(table);
      if (table === 'homework') {
        return new Promise<Row[]>((r) => mockState.pending.push(r)).then((data) => resolve({ data, error: null }), reject);
      }
      const data =
        table === 'profiles'
          ? [
              { id: 'T', full_name: 'Teacher', role: 'teacher', access_status: 'approved' },
              { id: 'M', full_name: 'Mentor', role: 'mentor', access_status: 'approved' },
              { id: 'S1', full_name: 'Student', role: 'student', access_status: 'approved' },
            ]
          : [];
      return Promise.resolve(resolve({ data, error: null }));
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
        getSession: () => ok({ session: { user: { id: mockState.me } } }),
        onAuthStateChange: (cb: (event: string, s: Session) => void) => {
          mockState.authHandler = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        getUser: () => ok({ user: { id: mockState.me } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string) => ok(name === 'general_chat_unread_count' ? 0 : []),
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.visibleHomework.length}</Text>;
}
const row = (id: string, status: 'submitted' | 'checked', student_id = 'S1') => ({
  id,
  student_id,
  course_id: 'A',
  title: id,
  description: '',
  status,
  photo_path: null,
  created_at: `2026-11-11T10:0${id.length}:00.000Z`,
});
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
/** Answers the oldest still-open homework fetch. */
const answer = async (rows: Row[], which = 0) => {
  const [resolve] = mockState.pending.splice(which, 1);
  await act(async () => resolve(rows));
  await flush();
};
const status = (id: string) => store.visibleHomework.find((h) => h.id === id)?.status;

let view: Awaited<ReturnType<typeof render>> | null = null;
async function mount() {
  view = await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  // The first load: A and B submitted.
  await answer([row('hA', 'submitted'), row('hB', 'submitted')]);
  expect(status('hB')).toBe('submitted');
}
beforeEach(() => {
  Object.assign(mockState, { me: 'M', pending: [], authHandler: null, calls: [] });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(
    () => ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
  );
});
afterEach(async () => {
  // Let anything still waiting finish, so it can't touch the next test.
  while (mockState.pending.length) await answer([]);
  await view?.unmount();
  view = null;
  jest.restoreAllMocks();
});

describe('A: an older reload finishing last', () => {
  it('does not overwrite the newer one (B stays checked)', async () => {
    await mount();
    // Check A → reload 1 starts; check B → reload 2 starts.
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = store.refresh();
    });
    await act(async () => {
      second = store.refresh();
    });
    expect(mockState.pending).toHaveLength(2);
    // Reload 2 (newest: A and B checked) answers first, then reload 1 (only A checked) answers late.
    await answer([row('hA', 'checked'), row('hB', 'checked')], 1);
    await answer([row('hA', 'checked'), row('hB', 'submitted')], 0);
    await act(() => Promise.all([first, second]).then(() => {}));
    expect(status('hA')).toBe('checked');
    expect(status('hB')).toBe('checked');
  });

  it('in order, the newer answer is used as before', async () => {
    await mount();
    await act(async () => {
      store.refresh();
    });
    await act(async () => {
      store.refresh();
    });
    await answer([row('hA', 'checked'), row('hB', 'submitted')], 0);
    await answer([row('hA', 'checked'), row('hB', 'checked')], 0);
    expect(status('hB')).toBe('checked');
  });
});

describe('B: a reload still running at sign-out', () => {
  it('sets nothing: no previous user, no homework, no profiles', async () => {
    mockState.me = 'T';
    await mount();
    await act(async () => {
      store.refresh();
    });
    expect(mockState.pending).toHaveLength(1);
    // Sign out before the reload answers.
    await act(async () => mockState.authHandler?.('SIGNED_OUT', null));
    await flush();
    expect(store.visibleHomework).toEqual([]);
    // The teacher's reload answers late, with every homework of the workspace.
    await answer([row('hA', 'submitted'), row('hB', 'checked'), row('hC', 'submitted', 'S2')]);
    expect(store.visibleHomework).toEqual([]);
    expect(store.currentUser).toBeNull();
    expect(store.users).toEqual([]);
  });

  it('nor after the next user signed in: the student only ever sees their own load', async () => {
    mockState.me = 'T';
    await mount();
    await act(async () => {
      store.refresh();
    });
    await act(async () => mockState.authHandler?.('SIGNED_OUT', null));
    await flush();
    // The student signs in; their first load starts (and is still waiting).
    mockState.me = 'S1';
    await act(async () => mockState.authHandler?.('SIGNED_IN', { user: { id: 'S1' } }));
    await flush();
    expect(mockState.pending).toHaveLength(2);
    // The teacher's late answer arrives first: nothing of it is shown.
    await answer([row('hA', 'submitted'), row('hB', 'checked'), row('hC', 'submitted', 'S2')], 0);
    expect(store.visibleHomework).toEqual([]);
    // Then the student's own answer.
    await answer([row('hA', 'submitted')], 0);
    expect(store.visibleHomework.map((h) => h.id)).toEqual(['hA']);
    expect(store.currentUser?.id).toBe('S1');
  });
});
