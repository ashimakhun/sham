// QA ARU-169 AC 1 / AC 10: the real StoreProvider against a fake Supabase client. Only the teacher calls
// workspace_usernames() (students and mentors never ask for anyone's username), and its rows become memberUsernames.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  me: 'T',
  profiles: [] as Record<string, unknown>[],
  rpcs: [] as { name: string; args: unknown }[],
  usernamesError: false,
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in', 'maybeSingle', 'single'])
      q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === 'profiles' ? mockState.profiles : [], error: null });
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
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        mockState.rpcs.push({ name, args });
        if (name === 'workspace_usernames') {
          if (mockState.usernamesError) return Promise.resolve({ data: null, error: { message: 'offline' } });
          return ok([
            { user_id: 'T', username: 'tess' },
            { user_id: 'S', username: 'sam' },
          ]);
        }
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
  return <Text>{store.users.length}</Text>;
}
const profile = (id: string, role: string) => ({ id, full_name: id, role, access_status: 'approved' });

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
  mockState.rpcs = [];
  mockState.usernamesError = false;
  mockState.profiles = [profile('T', 'teacher'), profile('M', 'mentor'), profile('S', 'student')];
});

it('the teacher loads the workspace usernames', async () => {
  mockState.me = 'T';
  await mount();
  expect(mockState.rpcs.map((r) => r.name)).toContain('workspace_usernames');
  expect(store.memberUsernames).toEqual({ T: 'tess', S: 'sam' });
});

it.each(['S', 'M'])('%s (not the teacher) never asks for usernames and has none', async (who) => {
  mockState.me = who;
  await mount();
  expect(mockState.rpcs.map((r) => r.name)).not.toContain('workspace_usernames');
  expect(store.memberUsernames).toEqual({});
});

it('an error leaves the screen without usernames rather than failing the load', async () => {
  mockState.me = 'T';
  mockState.usernamesError = true;
  await mount();
  expect(store.dataLoaded).toBe(true);
  expect(store.memberUsernames).toEqual({});
});

it('a non-teacher calling makeResetCode is refused in the app before any request', async () => {
  mockState.me = 'S';
  await mount();
  await expect(store.makeResetCode('M')).rejects.toBeTruthy();
  expect(mockState.rpcs.map((r) => r.name)).not.toContain('make_reset_code');
});
