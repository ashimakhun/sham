// QA ARU-157: gaps in aru157-store-stale-load.test.tsx. Three overlapping reloads answering out of order keep the
// newest; a switch to another user with no sign-out in between drops the previous user's late answer; and a sign-out
// while the teacher's reload waits at a later step (the access requests) sets nothing after it.
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Row = Record<string, unknown>;
type Session = { user: { id: string } } | null;

const mockState = {
  me: 'M',
  deferHomework: true,
  deferRequests: false,
  homework: [] as ((rows: Row[]) => void)[],
  requests: [] as ((rows: Row[]) => void)[],
  authHandler: null as null | ((event: string, s: Session) => void),
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      if (table === 'homework' && mockState.deferHomework) {
        return new Promise<Row[]>((r) => mockState.homework.push(r)).then((data) => resolve({ data, error: null }), reject);
      }
      const data =
        table === 'profiles'
          ? [
              { id: 'T', full_name: 'Teacher', role: 'teacher', access_status: 'approved' },
              { id: 'M', full_name: 'Mentor', role: 'mentor', access_status: 'approved' },
              { id: 'S1', full_name: 'Student', role: 'student', access_status: 'approved' },
            ]
          : table === 'homework'
            ? [{ id: 'hT', student_id: 'S1', course_id: 'A', title: 'hT', description: '', status: 'submitted', photo_path: null, created_at: '2026-11-11T10:00:00.000Z' }]
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
      rpc: (name: string) => {
        if (name === 'access_requests' && mockState.deferRequests) {
          return new Promise((r) => mockState.requests.push((rows) => r({ data: rows, error: null })));
        }
        return ok(name === 'general_chat_unread_count' ? 0 : []);
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
  for (let i = 0; i < 6; i++) await act(async () => {});
};
const answerHomework = async (rows: Row[], which = 0) => {
  const [resolve] = mockState.homework.splice(which, 1);
  await act(async () => resolve(rows));
  await flush();
};
const status = (id: string) => store.visibleHomework.find((h) => h.id === id)?.status;
const request = (id: string, name: string) => ({ id, full_name: name, email: `${id}@x.test`, access_status: 'pending', created_at: '2026-11-11T09:00:00.000Z' });

let view: Awaited<ReturnType<typeof render>> | null = null;
async function mount() {
  view = await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
}
beforeEach(() => {
  Object.assign(mockState, { me: 'M', deferHomework: true, deferRequests: false, homework: [], requests: [], authHandler: null });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(
    () => ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
  );
});
afterEach(async () => {
  while (mockState.homework.length) await answerHomework([]);
  while (mockState.requests.length) {
    const r = mockState.requests.shift()!;
    await act(async () => r([]));
  }
  await view?.unmount();
  view = null;
  jest.restoreAllMocks();
});

it('three overlapping reloads answering 3, 1, 2: the newest (third) state stays', async () => {
  await mount();
  await answerHomework([row('hA', 'submitted'), row('hB', 'submitted')]);
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      store.refresh();
    });
  }
  expect(mockState.homework).toHaveLength(3);
  await answerHomework([row('hA', 'checked'), row('hB', 'checked')], 2);
  await answerHomework([row('hA', 'submitted'), row('hB', 'submitted')], 0);
  await answerHomework([row('hA', 'checked'), row('hB', 'submitted')], 0);
  expect(status('hA')).toBe('checked');
  expect(status('hB')).toBe('checked');
});

it('a switch to another user with no sign-out in between drops the previous user\'s late answer', async () => {
  mockState.me = 'T';
  await mount();
  await answerHomework([row('hA', 'submitted')]);
  await act(async () => {
    store.refresh();
  });
  // The student signs in on top (SIGNED_IN with a different user, no SIGNED_OUT event).
  mockState.me = 'S1';
  await act(async () => mockState.authHandler?.('SIGNED_IN', { user: { id: 'S1' } }));
  await flush();
  // The teacher's late answer, with everyone's homework, arrives first.
  await answerHomework([row('hA', 'submitted'), row('hC', 'checked', 'S2')], 0);
  expect(store.visibleHomework.map((h) => h.id)).not.toContain('hC');
  await answerHomework([row('hA', 'submitted')], 0);
  expect(store.currentUser?.id).toBe('S1');
  expect(store.visibleHomework.map((h) => h.id)).toEqual(['hA']);
});

it('sign-out while the teacher\'s reload waits for the access requests: nothing is set after it', async () => {
  mockState.me = 'T';
  mockState.deferHomework = false;
  await mount();
  await flush();
  // The first load is waiting on the access requests; answer it so the app is loaded.
  mockState.deferRequests = true;
  await act(async () => {
    store.refresh();
  });
  await flush();
  expect(mockState.requests.length).toBeGreaterThanOrEqual(1);
  await act(async () => mockState.authHandler?.('SIGNED_OUT', null));
  await flush();
  // The teacher's late answer to the access requests.
  while (mockState.requests.length) {
    const r = mockState.requests.shift()!;
    await act(async () => r([request('P1', 'Pending person')]));
  }
  await flush();
  expect(store.accessRequests).toEqual([]);
  expect(store.users).toEqual([]);
  expect(store.currentUser).toBeNull();
});
