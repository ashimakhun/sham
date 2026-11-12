// QA ARU-156: gaps in aru156-store-foreground-reload.test.tsx. Each real trip to the background reloads exactly once
// (no storm over several trips), a signed-out app never reloads on returning (the handler is gone with the session),
// and an account still waiting for approval doesn't run the full reload either.
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  status: 'approved' as 'approved' | 'pending',
  fetches: [] as string[],
  authCb: null as null | ((event: string, session: unknown) => void),
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in', 'maybeSingle', 'single'])
      q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => {
      mockState.fetches.push(table);
      const data =
        table === 'profiles'
          ? [{ id: 'M', full_name: 'M', role: 'mentor', access_status: mockState.status }]
          : [];
      return resolve({ data, error: null });
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
        getUser: () => ok({ user: { id: 'M' } }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          mockState.authCb = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
      from: (table: string) => query(table),
      rpc: (name: string) => ok(name === 'general_chat_unread_count' ? 0 : []),
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: (paths: string[]) => ok(paths.map((path) => ({ path, signedUrl: path }))) }) },
    },
  };
});

function Probe() {
  useStore();
  return <Text>probe</Text>;
}

// AppState listeners that really go away when removed, so a removed handler can't be called by mistake.
let listeners: Set<(s: string) => void>;
const goTo = (state: string) => act(async () => [...listeners].forEach((cb) => cb(state)));
const flush = async () => {
  await act(async () => {});
  await act(async () => {});
};
const homeworkFetches = () => mockState.fetches.filter((t) => t === 'homework').length;

let view: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => {
  Object.assign(mockState, { status: 'approved', fetches: [], authCb: null });
  listeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    const fn = cb as (s: string) => void;
    listeners.add(fn);
    return { remove: () => listeners.delete(fn) } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(async () => {
  await act(async () => {});
  await view?.unmount();
  view = null;
  jest.restoreAllMocks();
});
async function mount() {
  view = await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
}

it('three trips to the background reload three times, once each', async () => {
  await mount();
  mockState.fetches = [];
  for (let i = 1; i <= 3; i++) {
    await goTo('background');
    await goTo('active');
    await flush();
    expect(homeworkFetches()).toBe(i);
  }
});

it('signed out: returning from the background reloads nothing', async () => {
  await mount();
  expect(mockState.authCb).not.toBeNull();
  await act(async () => mockState.authCb?.('SIGNED_OUT', null));
  await flush();
  mockState.fetches = [];
  await goTo('background');
  await goTo('active');
  await flush();
  expect(homeworkFetches()).toBe(0);
});

it('an account waiting for approval: returning from the background runs no full reload', async () => {
  mockState.status = 'pending';
  await mount();
  mockState.fetches = [];
  await goTo('background');
  await goTo('active');
  await flush();
  expect(homeworkFetches()).toBe(0);
});
