// ARU-165 QA: AC 9 on another device when the app comes back to the foreground. (Mock copied from aru165-store-recovery.)
// ARU-165: the real StoreProvider. needsRecoveryCode from my_recovery_code_saved() (AC 1), the code kept for the app
// session (AC 4), save / replaced (AC 3, two devices), Make a new code (AC 6–7), Forgot password (AC 9–12) and the
// password-changed sign-out on another device (AC 9).
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';
import { RecoveryCodeReplaced } from '@/lib/recovery';

const mock = {
  usernameRows: [{ username: 'sam' }] as { username: string }[],
  saved: false as boolean | 'error',
  rpc: jest.fn(),
  invoke: jest.fn(),
  getUser: jest.fn(),
  signInWithPassword: jest.fn(),
  signOut: jest.fn(),
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
            ? { data: mock.usernameRows, error: null }
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
        getSession: () => ok({ session: { user: { id: 'S1', email: 'sam@users.sham.invalid' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: (...a: unknown[]) => mock.getUser(...a),
        signInWithPassword: (...a: unknown[]) => mock.signInWithPassword(...a),
        signOut: (...a: unknown[]) => mock.signOut(...a),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        if (name === 'my_recovery_code_saved') {
          return mock.saved === 'error'
            ? Promise.resolve({ data: null, error: { message: 'Could not find the function' } })
            : ok(mock.saved);
        }
        if (['make_recovery_code', 'save_recovery_code'].includes(name)) return mock.rpc(name, args);
        return ok([]);
      },
      functions: { invoke: (...a: unknown[]) => mock.invoke(...a) },
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
/** An Edge Function's error answer as supabase-js gives it. */
const httpError = (body: unknown) => ({ name: 'FunctionsHttpError', context: { json: async () => body } });


const appStateListeners: ((s: string) => void)[] = [];
const appStateListener = (s: string) => appStateListeners.forEach((fn) => fn(s));
beforeEach(() => {
  appStateListeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, fn: (s: string) => void) => {
    appStateListeners.push(fn);
    return { remove: () => {} };
  }) as unknown as typeof AppState.addEventListener);
  mock.usernameRows = [{ username: 'sam' }];
  mock.saved = true;
  mock.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mock.invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  mock.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'S1' } }, error: null });
  mock.signInWithPassword.mockReset();
  mock.signOut.mockReset().mockResolvedValue({ error: null });
});

it('AC 9: a session ended elsewhere signs out with the password-changed notice when the app returns to the foreground', async () => {
  await mount();
  expect(mock.signOut).not.toHaveBeenCalled();
  mock.getUser.mockResolvedValue({
    data: { user: null },
    error: { code: 'session_not_found', status: 403, message: 'Session from session_id claim in JWT does not exist' },
  });
  expect(appStateListeners.length).toBeGreaterThan(0);
  await act(async () => {
    appStateListener('active');
  });
  await act(async () => {});
  expect(mock.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(store.accountNotice).toBe('You were signed out because your password was changed.');
});

it('AC 9: the global sign-out is never used (it would end the sessions of the device that just recovered)', async () => {
  await mount();
  mock.getUser.mockResolvedValue({ data: { user: null }, error: { code: 'session_not_found', status: 403, message: '' } });
  await act(async () => {
    appStateListener('active');
  });
  await act(async () => {});
  for (const call of mock.signOut.mock.calls) expect(call[0]).toEqual({ scope: 'local' });
});
