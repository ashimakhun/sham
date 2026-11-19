// ARU-168: the real StoreProvider. needsUsername comes from the own usernames row (AC 1); chooseUsername() calls
// choose_username(), refreshes the session and reloads (AC 3); "taken" and offline errors are shown and nothing else
// changes (AC 4); "already set" just reloads (two devices); Change password uses the latest Auth address (AC 5).
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mock = {
  usernameRows: [] as { username: string }[] | null,
  rpc: jest.fn(),
  refreshSession: jest.fn(),
  getUser: jest.fn(),
  signInWithPassword: jest.fn(),
  updateUser: jest.fn(),
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'insert', 'delete', 'limit', 'lt', 'or', 'in', 'eq', 'update']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === 'profiles'
          ? { data: [{ id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' }], error: null }
          : table === 'usernames'
            ? mock.usernameRows
              ? { data: mock.usernameRows, error: null }
              : { data: null, error: { message: 'Network request failed' } }
            : { data: [], error: null },
      );
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'S1', email: 'sam@example.com' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        refreshSession: (...a: unknown[]) => mock.refreshSession(...a),
        getUser: (...a: unknown[]) => mock.getUser(...a),
        signInWithPassword: (...a: unknown[]) => mock.signInWithPassword(...a),
        updateUser: (...a: unknown[]) => mock.updateUser(...a),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => (name === 'choose_username' ? mock.rpc(name, args) : ok([])),
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
  mock.usernameRows = [];
  mock.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mock.refreshSession.mockReset().mockResolvedValue({ data: {}, error: null });
  mock.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'S1', email: 'sam@example.com' } }, error: null });
  mock.signInWithPassword.mockReset().mockResolvedValue({ data: { user: { id: 'S1' }, session: {} }, error: null });
  mock.updateUser.mockReset().mockResolvedValue({ data: { user: { id: 'S1' } }, error: null });
});

it('AC 1: no usernames row → needsUsername', async () => {
  await mount();
  expect(store.myUsername).toBeNull();
  expect(store.needsUsername).toBe(true);
});

it('AC 1: a usernames row → no gate', async () => {
  mock.usernameRows = [{ username: 'sam' }];
  await mount();
  expect(store.myUsername).toBe('sam');
  expect(store.needsUsername).toBe(false);
});

it('a failed usernames request never shows the gate', async () => {
  mock.usernameRows = null;
  await mount();
  expect(store.myUsername).toBeUndefined();
  expect(store.needsUsername).toBe(false);
});

it('AC 3: Save calls choose_username (lower case, trimmed), refreshes the session and leaves the gate', async () => {
  await mount();
  mock.usernameRows = [{ username: 'dana_s' }];
  await act(() => store.chooseUsername(' Dana_S ', ' Dana '));
  expect(mock.rpc).toHaveBeenCalledWith('choose_username', { username: 'dana_s', display_name: 'Dana' });
  expect(mock.refreshSession).toHaveBeenCalled();
  expect(store.myUsername).toBe('dana_s');
  expect(store.needsUsername).toBe(false);
});

it('AC 3 edge case: a failed session refresh still continues', async () => {
  mock.refreshSession.mockRejectedValue(new Error('offline'));
  await mount();
  mock.usernameRows = [{ username: 'dana_s' }];
  await act(() => store.chooseUsername('dana_s', 'Dana'));
  expect(store.needsUsername).toBe(false);
});

it('AC 4: taken → part 1\'s text, still on the gate', async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { message: 'This username is taken. Try another one.', code: '23505', hint: 'sham:username_taken' } });
  await mount();
  await expect(store.chooseUsername('taken', 'Dana')).rejects.toThrow('This username is taken. Try another one.');
  expect(store.needsUsername).toBe(true);
  expect(mock.refreshSession).not.toHaveBeenCalled();
});

it('AC 4: offline → the network text, still on the gate', async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Network request failed', code: '' } });
  await mount();
  await expect(store.chooseUsername('dana_s', 'Dana')).rejects.toThrow('Could not reach the server');
  expect(store.needsUsername).toBe(true);
});

it('two devices: already set → reload, no error', async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { message: 'This account already has a username.', code: '23505', hint: 'sham:username_already_set' } });
  await mount();
  mock.usernameRows = [{ username: 'other_device' }];
  await act(() => store.chooseUsername('dana_s', 'Dana'));
  expect(store.myUsername).toBe('other_device');
  expect(store.needsUsername).toBe(false);
});

it('AC 5: Change password signs in with the latest Auth address, not the session\'s old email', async () => {
  await mount();
  mock.getUser.mockResolvedValue({ data: { user: { id: 'S1', email: 'dana_s@users.sham.invalid' } }, error: null });
  await act(() => store.changePassword('oldpass', 'newpass1'));
  expect(mock.signInWithPassword).toHaveBeenCalledWith({ email: 'dana_s@users.sham.invalid', password: 'oldpass' });
});
