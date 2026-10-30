// ARU-31 QA (post-merge, PR #36): the real StoreProvider against a fake Supabase client. A chat message from someone
// else refetches only the mockCounts (one batched request), never the full load (AC 7); own messages don't refetch; the
// app returning to the foreground refetches the mockCounts; opening a chat clears its count at once (AC 5).
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Handler = (payload: { new: Record<string, unknown> }) => void;

// Recorded mockCalls and the live-update mockHandlers the store registers.
const mockCalls = { from: [] as string[], rpc: [] as string[] };
const mockHandlers: Record<string, Handler> = {};
let mockCounts: { course_id: string; unread: number }[] = [];

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  // A query builder: every chained call returns itself; awaiting it resolves to an empty list.
  const query = (): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'limit', 'lt', 'or']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return q;
  };
  const channel = () => {
    const c: Record<string, unknown> = {};
    c.on = (_t: string, filter: { table: string; event: string }, cb: Handler) => {
      mockHandlers[`${filter.table}:${filter.event}`] = cb;
      return c;
    };
    c.subscribe = () => c;
    return c;
  };
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'S1' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => {
        mockCalls.from.push(table);
        return query();
      },
      rpc: (name: string) => {
        mockCalls.rpc.push(name);
        return ok(name === 'chat_unread_counts' ? mockCounts : null);
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
  return <Text>{String(store.unreadCount('A'))}</Text>;
}

const countRpcs = () => mockCalls.rpc.filter((n) => n === 'chat_unread_counts').length;
const flush = () => act(async () => {});

// jest-expo's AppState returns no subscription; the store removes its listener on unmount, so give it one.
const appListeners: ((s: string) => void)[] = [];
beforeEach(() => {
  appListeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, cb) => {
    appListeners.push(cb as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
  mockCalls.from.length = 0;
  mockCalls.rpc.length = 0;
  mockCounts = [{ course_id: 'A', unread: 3 }];
});

it('AC7: messages from others refetch only the counts, once per burst, never the full load', async () => {
  jest.useFakeTimers();
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  await flush();
  expect(store.unreadCount('A')).toBe(3);
  const fullLoads = mockCalls.from.filter((t) => t === 'homework').length;
  const before = countRpcs();

  const onMessage = mockHandlers['course_messages:INSERT'];
  expect(onMessage).toBeDefined();
  mockCounts = [{ course_id: 'A', unread: 5 }];
  await act(async () => {
    onMessage({ new: { author_id: 'M', course_id: 'A' } });
    onMessage({ new: { author_id: 'T', course_id: 'A' } });
    jest.advanceTimersByTime(600);
  });
  await flush();

  expect(countRpcs()).toBe(before + 1); // two messages, one batched request
  expect(mockCalls.from.filter((t) => t === 'homework').length).toBe(fullLoads); // no full reload
  expect(store.unreadCount('A')).toBe(5);
  jest.useRealTimers();
});

it('AC8: my own message does not refetch the counts', async () => {
  jest.useFakeTimers();
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  await flush();
  const before = countRpcs();
  await act(async () => {
    mockHandlers['course_messages:INSERT']({ new: { author_id: 'S1', course_id: 'A' } });
    jest.advanceTimersByTime(600);
  });
  expect(countRpcs()).toBe(before);
  jest.useRealTimers();
});

it('AC7: back from the background refetches the counts', async () => {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  await flush();
  const before = countRpcs();
  mockCounts = [{ course_id: 'A', unread: 7 }];
  await act(async () => appListeners.forEach((l) => l('active')));
  await flush();
  expect(countRpcs()).toBeGreaterThan(before);
  expect(store.unreadCount('A')).toBe(7);
});

it('AC5: marking a chat read clears its count at once, then saves and refetches', async () => {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  await flush();
  expect(store.unreadCount('A')).toBe(3);
  mockCounts = [];
  await act(async () => {
    await store.markChatRead('A', 'msg-9');
  });
  expect(mockCalls.rpc).toContain('mark_chat_read');
  expect(store.unreadCount('A')).toBe(0);
});
