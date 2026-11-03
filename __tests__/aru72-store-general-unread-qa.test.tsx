// QA ARU-72: gaps in aru72-store-general-unread.test.tsx: a failed mark-read (offline) doesn't throw and the count
// comes back on the next refetch, a course chat message never refetches the general count, and a count reply after
// mark-read doesn't bring the badge back.
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Handler = (payload: { new: Record<string, unknown> }) => void;
const mockState = {
  me: 'S',
  profiles: [] as Record<string, unknown>[],
  rpcs: [] as { name: string; args: unknown }[],
  general: 0,
  markError: null as null | { message: string },
  handlers: {} as Record<string, Handler>,
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
    const c: Record<string, unknown> = {};
    c.on = (_e: string, filter: { table: string }, cb: Handler) => {
      mockState.handlers[filter.table] = cb;
      return c;
    };
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
        if (name === 'general_chat_unread_count') return ok(mockState.general);
        if (name === 'chat_unread_counts') return ok([{ course_id: 'A', unread: 2 }]);
        if (name === 'mark_general_chat_read' && mockState.markError)
          return Promise.resolve({ data: null, error: mockState.markError });
        return ok(null);
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
  return <Text>{store.generalUnreadCount}</Text>;
}
const profile = (id: string, role: string, access_status = 'approved') => ({ id, full_name: id, role, access_status });

let view: Awaited<ReturnType<typeof render>> | null = null;
async function mount() {
  view = await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await act(async () => {});
  await act(async () => {});
}
// Unmount and flush, so a late reply from one test's store can't update the next test's `store`.
afterEach(async () => {
  await act(async () => {});
  await view?.unmount();
  view = null;
});
const names = () => mockState.rpcs.map((r) => r.name);

let appStateListeners: ((s: string) => void)[] = [];
beforeEach(() => {
  mockState.rpcs = [];
  mockState.handlers = {};
  mockState.general = 0;
  mockState.markError = null;
  mockState.me = 'S';
  mockState.profiles = [profile('S', 'student'), profile('M', 'mentor')];
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    appStateListeners.push(cb as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(() => jest.useRealTimers());


it('a count reply that arrives after mark-read is ignored (no badge flashes back)', async () => {
  mockState.general = 6;
  await mount();
  jest.useFakeTimers();
  // A message from someone else starts a debounced refetch, which would answer 6 ...
  await act(async () => mockState.handlers.general_messages?.({ new: { author_id: 'M' } }));
  // ... then the user opens the chat and reads; the server now says 0.
  mockState.general = 0;
  await act(() => store.markGeneralChatRead('g2'));
  await act(async () => jest.advanceTimersByTime(2000));
  expect(store.generalUnreadCount).toBe(0);
});

it('AC 11 live: a course chat message never refetches the general count', async () => {
  await mount();
  jest.useFakeTimers();
  const general = () => names().filter((n) => n === 'general_chat_unread_count').length;
  const before = general();
  await act(async () => mockState.handlers.course_messages?.({ new: { author_id: 'M', course_id: 'A' } }));
  await act(async () => jest.advanceTimersByTime(2000));
  expect(general()).toBe(before);
});

it('edge offline: a failed mark-read doesn\'t throw, and the badge may come back from the server count', async () => {
  mockState.general = 4;
  await mount();
  mockState.markError = { message: 'Network request failed' };
  await expect(act(() => store.markGeneralChatRead('g1'))).resolves.toBeUndefined();
  // The save failed, so the server still says 4: the next refetch (here: back from the background) shows it again.
  await act(async () => appStateListeners.forEach((cb) => cb('active')));
  await act(async () => {});
  await act(async () => {});
  expect(store.generalUnreadCount).toBe(4);
});
