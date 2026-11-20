// ARU-165: the real StoreProvider. needsRecoveryCode from my_recovery_code_saved() (AC 1), the code kept for the app
// session (AC 4), save / replaced (AC 3, two devices), Make a new code (AC 6–7), Forgot password (AC 9–12) and the
// password-changed sign-out on another device (AC 9).
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

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

beforeEach(() => {
  mock.usernameRows = [{ username: 'sam' }];
  mock.saved = false;
  let n = 0;
  mock.rpc.mockReset().mockImplementation(async (name: string) =>
    name === 'make_recovery_code' ? { data: `CODE-${++n}`, error: null } : { data: null, error: null },
  );
  mock.invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  mock.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'S1' } }, error: null });
  mock.signInWithPassword.mockReset().mockResolvedValue({ data: { user: { id: 'S1' }, session: {} }, error: null });
  mock.signOut.mockReset().mockResolvedValue({ error: null });
});

describe('AC 1: needsRecoveryCode', () => {
  it('a username account without a saved code needs one', async () => {
    await mount();
    expect(store.needsRecoveryCode).toBe(true);
  });
  it('a saved code: no gate', async () => {
    mock.saved = true;
    await mount();
    expect(store.needsRecoveryCode).toBe(false);
  });
  it('an older account without a username: no gate (Choose a username comes first)', async () => {
    mock.usernameRows = [];
    await mount();
    expect(store.needsUsername).toBe(true);
    expect(store.needsRecoveryCode).toBe(false);
  });
  it('unknown (before 0073 or offline): no gate', async () => {
    mock.saved = 'error';
    await mount();
    expect(store.needsRecoveryCode).toBe(false);
  });
});

describe('AC 3 / AC 4: getting and saving a code', () => {
  it('the same code is kept for the app session; saving it clears the gate', async () => {
    await mount();
    let code = '';
    await act(async () => {
      code = await store.getRecoveryCode();
    });
    expect(code).toBe('CODE-1');
    await act(async () => {
      expect(await store.getRecoveryCode()).toBe('CODE-1');
    });
    expect(mock.rpc.mock.calls.filter((c) => c[0] === 'make_recovery_code')).toHaveLength(1);
    await act(async () => {
      await store.saveRecoveryCode('CODE-1');
    });
    expect(mock.rpc).toHaveBeenCalledWith('save_recovery_code', { code: 'CODE-1' });
    expect(store.needsRecoveryCode).toBe(false);
  });

  it('offline: the network message, nothing changes', async () => {
    await mount();
    mock.rpc.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(store.saveRecoveryCode('CODE-1')).rejects.toThrow('Could not reach the server');
    expect(store.needsRecoveryCode).toBe(true);
  });

  it('two devices: an older code is refused and a fresh one comes with the error', async () => {
    await mount();
    mock.rpc.mockImplementation(async (name: string) =>
      name === 'save_recovery_code'
        ? { data: null, error: { message: 'replaced', code: '22023', hint: 'sham:recovery_code_replaced' } }
        : { data: 'FRESH-CODE', error: null },
    );
    let caught: unknown;
    await act(async () => {
      await store.saveRecoveryCode('OLD').catch((e) => (caught = e));
    });
    expect(caught).toBeInstanceOf(RecoveryCodeReplaced);
    expect((caught as RecoveryCodeReplaced).fresh).toBe('FRESH-CODE');
    expect(store.needsRecoveryCode).toBe(true);
  });
});

describe('AC 6–7: Make a new code', () => {
  it('the right password returns the code from the Edge Function', async () => {
    await mount();
    mock.invoke.mockResolvedValue({ data: { code: 'NEW1-NEW2-NEW3-NEW4' }, error: null });
    await act(async () => {
      expect(await store.makeNewRecoveryCode('secret1')).toBe('NEW1-NEW2-NEW3-NEW4');
    });
    expect(mock.invoke).toHaveBeenCalledWith('new-recovery-code', { body: { password: 'secret1' } });
  });
  it('a wrong password: the existing Current password is incorrect', async () => {
    await mount();
    mock.invoke.mockResolvedValue({ data: null, error: httpError({ code: 'wrong_password', error: 'x' }) });
    await expect(store.makeNewRecoveryCode('nope')).rejects.toThrow('Current password is incorrect');
  });
});

describe('AC 9–12: Forgot password', () => {
  it('AC 9: success signs in with the username and the new password', async () => {
    await mount();
    await act(async () => {
      await store.recoverPassword(' Sam ', 'abcd-efgh-jkmn-pqrs', 'secret1');
    });
    expect(mock.invoke).toHaveBeenCalledWith('recover-password', {
      body: { username: 'sam', code: 'abcd-efgh-jkmn-pqrs', password: 'secret1' },
    });
    expect(mock.signInWithPassword).toHaveBeenCalledWith({ email: 'sam@users.sham.invalid', password: 'secret1' });
  });

  it.each([
    [{ code: 'wrong_code' }, 'Incorrect username or recovery code.'],
    [{ code: 'locked' }, 'Too many attempts. Try again in 15 minutes.'],
    [{ code: 'weak_password', error: 'Password should be at least 8 characters.' }, 'The password is too weak. Use at least 8 characters.'],
    [{ code: 'failed' }, 'Something went wrong. Please try again.'],
  ])('%j → %s, no sign-in', async (body, text) => {
    await mount();
    mock.invoke.mockResolvedValue({ data: null, error: httpError(body) });
    await expect(store.recoverPassword('sam', 'ABCD-EFGH-JKMN-PQRS', 'secret1')).rejects.toThrow(text);
    expect(mock.signInWithPassword).not.toHaveBeenCalled();
  });

  it('AC 12: offline → the network message', async () => {
    await mount();
    mock.invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send' } });
    await expect(store.recoverPassword('sam', 'ABCD-EFGH-JKMN-PQRS', 'secret1')).rejects.toThrow('Could not reach the server');
  });
});

describe('AC 9: another device', () => {
  it('session_not_found on start signs out locally with the password-changed notice', async () => {
    mock.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'session_not_found', status: 403, message: 'Session from session_id claim in JWT does not exist' },
    });
    await mount();
    await act(async () => {});
    expect(mock.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(store.accountNotice).toBe('You were signed out because your password was changed.');
  });

  it('a deleted user still gets "Your account was deleted"; a network error changes nothing', async () => {
    mock.getUser.mockResolvedValue({ data: { user: null }, error: { code: 'user_not_found', status: 403, message: 'User not found' } });
    await mount();
    await act(async () => {});
    expect(store.accountNotice).toBe('Your account was deleted');
  });

  it('a network error changes nothing', async () => {
    mock.getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } });
    await mount();
    await act(async () => {});
    expect(mock.signOut).not.toHaveBeenCalled();
    expect(store.accountNotice).toBeNull();
  });
});
