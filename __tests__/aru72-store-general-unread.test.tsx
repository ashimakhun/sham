// ARU-72: the real StoreProvider against a fake Supabase client. The general chat count is loaded with the course
// counts, refreshed (debounced) by others' general_messages inserts and on return from the background, cleared by
// markGeneralChatRead, 0 while the chat is open, kept apart from the course counts, and never loaded for a waiting
// account.
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Handler = (payload: { new: Record<string, unknown> }) => void;
const mockState = {
  me: 'S',
  profiles: [] as Record<string, unknown>[],
  rpcs: [] as { name: string; args: unknown }[],
  general: 0,
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

async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await act(async () => {});
  await act(async () => {});
}
const names = () => mockState.rpcs.map((r) => r.name);

let appStateListeners: ((s: string) => void)[] = [];
beforeEach(() => {
  mockState.rpcs = [];
  mockState.handlers = {};
  mockState.general = 0;
  mockState.me = 'S';
  mockState.profiles = [profile('S', 'student'), profile('M', 'mentor')];
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    appStateListeners.push(cb as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(() => jest.useRealTimers());

it('loads the general count with the course counts, kept apart from them (AC1, AC11)', async () => {
  mockState.general = 5;
  await mount();
  expect(names()).toEqual(expect.arrayContaining(['chat_unread_counts', 'general_chat_unread_count']));
  expect(store.generalUnreadCount).toBe(5);
  expect(store.unreadCount('A')).toBe(2);
});

it('a waiting account loads no count (roles)', async () => {
  mockState.me = 'P';
  mockState.profiles = [profile('P', 'student', 'pending')];
  mockState.general = 5;
  await mount();
  expect(names()).not.toContain('general_chat_unread_count');
  expect(store.generalUnreadCount).toBe(0);
});

it('markGeneralChatRead clears the count at once and saves by message id (AC4)', async () => {
  mockState.general = 3;
  await mount();
  expect(store.generalUnreadCount).toBe(3);
  mockState.general = 0;
  await act(() => store.markGeneralChatRead('g9'));
  expect(mockState.rpcs).toContainEqual({ name: 'mark_general_chat_read', args: { upto: 'g9' } });
  expect(store.generalUnreadCount).toBe(0);
  expect(store.unreadCount('A')).toBe(2); // AC11
});

it('0 while the chat is open (AC5)', async () => {
  mockState.general = 3;
  await mount();
  await act(async () => store.setGeneralChatOpen(true));
  expect(store.generalUnreadCount).toBe(0);
  await act(async () => store.setGeneralChatOpen(false));
  expect(store.generalUnreadCount).toBe(3);
});

it('live: others\' messages refetch the count once (debounced); own messages do not (AC6, AC7)', async () => {
  await mount();
  jest.useFakeTimers();
  const before = names().filter((n) => n === 'general_chat_unread_count').length;
  const onGeneral = mockState.handlers.general_messages;
  expect(onGeneral).toBeDefined();
  mockState.general = 3;
  await act(async () => {
    onGeneral({ new: { author_id: 'M' } });
    onGeneral({ new: { author_id: 'M' } });
    onGeneral({ new: { author_id: 'M' } });
    jest.advanceTimersByTime(600);
  });
  expect(names().filter((n) => n === 'general_chat_unread_count').length).toBe(before + 1);
  expect(store.generalUnreadCount).toBe(3);
  await act(async () => {
    onGeneral({ new: { author_id: 'S' } });
    jest.advanceTimersByTime(600);
  });
  expect(names().filter((n) => n === 'general_chat_unread_count').length).toBe(before + 1);
  expect(names().filter((n) => n === 'chat_unread_counts').length).toBe(1); // course counts not refetched
});

it('returning from the background refetches the count (AC6, AC8)', async () => {
  await mount();
  mockState.general = 7;
  await act(async () => appStateListeners.forEach((l) => l('active')));
  expect(store.generalUnreadCount).toBe(7);
});
