// ARU-77: the real StoreProvider's reset actions against a fake Supabase Auth. The session verifyOtp creates is held
// back (no currentUser, so no redirect and no approval gate) until the new password is saved; if saving fails the
// user is signed out again (local scope). An unfinished reset left by a killed app is signed out at start-up.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Listener = (event: string, session: unknown) => void;
const session = { user: { id: 'S1', email: 'sam@example.com' } };
const mockAuth = {
  listener: null as Listener | null,
  stored: null as unknown,
  resetPasswordForEmail: jest.fn(),
  verifyOtp: jest.fn(),
  updateUser: jest.fn(),
  signOut: jest.fn(),
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'insert', 'delete', 'limit', 'lt', 'or', 'in', 'eq', 'update']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === 'profiles' ? [{ id: 'S1', full_name: 'Student Sam', role: 'student' }] : [], error: null });
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: mockAuth.stored }),
        onAuthStateChange: (l: Listener) => {
          mockAuth.listener = l;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        resetPasswordForEmail: (...a: unknown[]) => mockAuth.resetPasswordForEmail(...a),
        verifyOtp: (...a: unknown[]) => mockAuth.verifyOtp(...a),
        updateUser: (...a: unknown[]) => mockAuth.updateUser(...a),
        signOut: (...a: unknown[]) => mockAuth.signOut(...a),
      },
      from: (table: string) => query(table),
      rpc: () => ok([]),
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
  for (let i = 0; i < 4; i++) await act(async () => {});
}

/** verifyOtp signs in: the client emits SIGNED_IN before resolving. */
function acceptCode() {
  mockAuth.verifyOtp.mockImplementation(async () => {
    mockAuth.listener?.('SIGNED_IN', session);
    return { data: { user: session.user, session }, error: null };
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAuth.stored = null;
  mockAuth.resetPasswordForEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  mockAuth.verifyOtp.mockReset();
  mockAuth.updateUser.mockReset().mockResolvedValue({ data: { user: session.user }, error: null });
  mockAuth.signOut.mockReset().mockImplementation(async () => {
    mockAuth.listener?.('SIGNED_OUT', null);
    return { error: null };
  });
});

it('AC2/AC3: sends the reset email to the trimmed address; errors keep their wording', async () => {
  await mount();
  await act(() => store.requestPasswordReset('  sam@example.com '));
  expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith('sam@example.com');
  mockAuth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { message: 'x', code: 'over_email_send_rate_limit', status: 429 } });
  await expect(store.requestPasswordReset('sam@example.com')).rejects.toThrow('Too many requests. Please wait a few minutes and try again.');
});

it('AC5/AC8: the session is held until the new password is saved, then the app opens', async () => {
  await mount();
  let release!: () => void;
  mockAuth.updateUser.mockImplementation(
    () => new Promise((r) => (release = () => r({ data: { user: session.user }, error: null }))),
  );
  acceptCode();
  let done!: Promise<void>;
  await act(async () => {
    done = store.resetPasswordWithCode(' sam@example.com ', '123 456', ' new pass ');
  });
  // Code accepted, password not saved yet: still signed out as far as the app knows.
  expect(store.session).toBeNull();
  expect(store.currentUser).toBeNull();
  expect(await AsyncStorage.getItem('sham.passwordResetPending')).toBe('1');
  await act(async () => {
    release();
    await done;
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
  expect(mockAuth.verifyOtp).toHaveBeenCalledWith({ email: 'sam@example.com', token: '123456', type: 'recovery' });
  expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: ' new pass ' });
  expect(store.session?.user.id).toBe('S1');
  expect(store.currentUser?.id).toBe('S1');
  expect(mockAuth.signOut).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('sham.passwordResetPending')).toBeNull();
});

it.each([
  ['wrong/expired', { message: 'Token has expired or is invalid', code: 'otp_expired', status: 403 }, 'This code is wrong or has expired. Check the email or send a new code.'],
  ['offline', { message: 'Network request failed', name: 'AuthRetryableFetchError', status: 0 }, 'Could not reach the server. Check your connection and try again.'],
])('AC7: a %s code changes nothing and stays signed out', async (_c, error, message) => {
  mockAuth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error });
  await mount();
  await expect(store.resetPasswordWithCode('sam@example.com', '123456', 'secret6')).rejects.toThrow(message);
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
  expect(mockAuth.signOut).not.toHaveBeenCalled();
  expect(store.session).toBeNull();
});

it.each([
  ['server rule', { message: 'Password should be at least 8 characters.', code: 'weak_password', status: 422 }, 'The password is too weak. Use at least 8 characters.'], // ARU-108 AC 7a
  ['same password', { message: 'New password should be different from the old password.', code: 'same_password', status: 422 }, 'The new password must be different from the current one'],
  ['offline', { message: 'Failed to fetch', name: 'AuthRetryableFetchError', status: 0 }, 'Could not reach the server. Check your connection and try again.'],
])('AC8: when saving fails (%s) the user is signed out locally and never enters the app', async (_c, error, message) => {
  acceptCode();
  mockAuth.updateUser.mockResolvedValue({ data: { user: null }, error });
  await mount();
  await expect(store.resetPasswordWithCode('sam@example.com', '123456', 'secret6')).rejects.toThrow(message);
  await act(async () => {});
  expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(store.session).toBeNull();
  expect(store.currentUser).toBeNull();
  expect(await AsyncStorage.getItem('sham.passwordResetPending')).toBeNull();
});

it('AC8: an app killed mid-reset starts signed out', async () => {
  await AsyncStorage.setItem('sham.passwordResetPending', '1');
  mockAuth.stored = session;
  mockAuth.signOut.mockImplementation(async () => {
    mockAuth.stored = null;
    return { error: null };
  });
  await mount();
  expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(store.ready).toBe(true);
  expect(store.session).toBeNull();
  expect(await AsyncStorage.getItem('sham.passwordResetPending')).toBeNull();
});

it('a normal start with a stored session still signs in', async () => {
  mockAuth.stored = session;
  await mount();
  expect(store.session?.user.id).toBe('S1');
  expect(store.currentUser?.id).toBe('S1');
  expect(mockAuth.signOut).not.toHaveBeenCalled();
});
