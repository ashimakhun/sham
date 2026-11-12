// ARU-156: back from the background, the store reloads everything once, so changes missed meanwhile appear and
// homework photos get fresh signed links (they last an hour). A brief 'inactive' (iOS Control Center, a system prompt)
// only refetches the chat counts, as before.
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  homework: [] as Record<string, unknown>[],
  signedRound: 0,
  fetches: [] as string[],
  rpcs: [] as string[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => {
      mockState.fetches.push(table);
      const data =
        table === 'profiles'
          ? [{ id: 'M', full_name: 'M', role: 'mentor', access_status: 'approved' }]
          : table === 'homework'
            ? mockState.homework
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
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string) => {
        mockState.rpcs.push(name);
        return ok(name === 'general_chat_unread_count' ? 0 : []);
      },
      channel,
      removeChannel: () => {},
      storage: {
        from: () => ({
          // Each round of links is different, like real signed links with a new expiry.
          createSignedUrls: (paths: string[]) => {
            mockState.signedRound++;
            return ok(paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}?round=${mockState.signedRound}` })));
          },
        }),
      },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.visibleHomework.length}</Text>;
}
const row = (id: string, photo_path: string | null = null) => ({
  id,
  student_id: 'S1',
  course_id: 'A',
  title: id,
  description: '',
  status: 'submitted',
  photo_path,
  created_at: `2026-11-11T10:0${id.length}:00.000Z`,
});

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
const flush = async () => {
  await act(async () => {});
  await act(async () => {});
};
afterEach(async () => {
  await act(async () => {});
  await view?.unmount();
  view = null;
  jest.restoreAllMocks();
});

let listeners: ((s: string) => void)[] = [];
const goTo = (state: string) => act(async () => listeners.forEach((cb) => cb(state)));
beforeEach(() => {
  Object.assign(mockState, { homework: [row('h1', 'S1/h1.jpg')], signedRound: 0, fetches: [], rpcs: [] });
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    listeners.push(cb as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});

describe('ARU-156: back from the background', () => {
  it('reloads once: homework sent meanwhile appears, and photos get fresh links', async () => {
    await mount();
    const firstLink = store.visibleHomework[0].photoUrl;
    expect(firstLink).toContain('round=1');

    // While in the background, a student sends a new homework (realtime missed it).
    await goTo('background');
    mockState.homework = [row('h1', 'S1/h1.jpg'), row('h22')];
    mockState.fetches = [];
    await goTo('active');
    await flush();

    expect(mockState.fetches.filter((t) => t === 'homework')).toHaveLength(1);
    expect(store.visibleHomework.map((h) => h.id).sort()).toEqual(['h1', 'h22']);
    const fresh = store.visibleHomework.find((h) => h.id === 'h1')?.photoUrl;
    expect(fresh).toContain('round=2');
    expect(fresh).not.toBe(firstLink);
    // load() also refetches the counts.
    expect(mockState.rpcs).toEqual(expect.arrayContaining(['chat_unread_counts', 'general_chat_unread_count']));
  });

  it('iOS: inactive → background → active also reloads once', async () => {
    await mount();
    await goTo('inactive');
    await goTo('background');
    mockState.fetches = [];
    await goTo('active');
    await flush();
    expect(mockState.fetches.filter((t) => t === 'homework')).toHaveLength(1);
  });

  it('a brief inactive (Control Center) only refetches the counts, no full reload', async () => {
    await mount();
    await goTo('inactive');
    mockState.fetches = [];
    mockState.rpcs = [];
    await goTo('active');
    await flush();
    expect(mockState.fetches).toEqual([]);
    expect(mockState.rpcs).toEqual(expect.arrayContaining(['chat_unread_counts', 'general_chat_unread_count']));
  });

  it('a second active without a new trip to the background does not reload again', async () => {
    await mount();
    await goTo('background');
    await goTo('active');
    await flush();
    mockState.fetches = [];
    await goTo('active');
    await flush();
    expect(mockState.fetches).toEqual([]);
  });
});
