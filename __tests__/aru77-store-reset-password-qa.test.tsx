// QA ARU-77: gaps in aru77-store-reset-password.test.tsx (same fake Supabase Auth): verifyOtp or updateUser throwing
// instead of returning an error, a rate limit on the code check, a USER_UPDATED event during the hold, a code with
// letters cleaned before it is sent, storage failing (the reset still works), and someone else's sign-out during the
// hold going through.
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
afterEach(() => jest.restoreAllMocks());

it('AC8: updateUser throwing (no answer) after the code was accepted: an error, signed out locally', async () => {
  acceptCode();
  mockAuth.updateUser.mockRejectedValue(new TypeError('Network request failed'));
  await mount();
  await expect(store.resetPasswordWithCode('sam@example.com', '123456', 'secret6')).rejects.toThrow();
  await act(async () => {});
  expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(store.session).toBeNull();
  expect(store.currentUser).toBeNull();
  expect(await AsyncStorage.getItem('sham.passwordResetPending')).toBeNull();
});

it('AC7: verifyOtp throwing: an error, nothing saved, still signed out', async () => {
  mockAuth.verifyOtp.mockRejectedValue(new TypeError('Network request failed'));
  await mount();
  await expect(store.resetPasswordWithCode('sam@example.com', '123456', 'secret6')).rejects.toThrow();
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
  expect(store.session).toBeNull();
});

it('AC9: a rate limit on the code check says so (not "wrong or expired")', async () => {
  mockAuth.verifyOtp.mockResolvedValue({ data: {}, error: { message: 'rate', code: 'over_request_rate_limit', status: 429 } });
  await mount();
  await expect(store.resetPasswordWithCode('sam@example.com', '123456', 'secret6')).rejects.toThrow(
    'Too many requests. Please wait a few minutes and try again.',
  );
});

it('AC4: a code with letters and dashes is cleaned to digits before it is sent', async () => {
  acceptCode();
  await mount();
  await act(() => store.resetPasswordWithCode('sam@example.com', '12a 34-56', 'secret6'));
  expect(mockAuth.verifyOtp).toHaveBeenCalledWith({ email: 'sam@example.com', token: '123456', type: 'recovery' });
});

it('AC5: a USER_UPDATED event while saving doesn\'t open the app early; the app opens once saved', async () => {
  acceptCode();
  let release!: () => void;
  mockAuth.updateUser.mockImplementation(
    () =>
      new Promise((r) => {
        mockAuth.listener?.('USER_UPDATED', session);
        release = () => r({ data: { user: session.user }, error: null });
      }),
  );
  await mount();
  let done!: Promise<void>;
  await act(async () => {
    done = store.resetPasswordWithCode('sam@example.com', '123456', 'secret6');
  });
  expect(store.session).toBeNull();
  await act(async () => {
    release();
    await done;
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
  expect(store.session?.user.id).toBe('S1');
});

it('edge: storage failing doesn\'t stop the reset', async () => {
  acceptCode();
  await mount();
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await act(() => store.resetPasswordWithCode('sam@example.com', '123456', 'secret6'));
  for (let i = 0; i < 3; i++) await act(async () => {});
  expect(mockAuth.updateUser).toHaveBeenCalled();
  expect(store.session?.user.id).toBe('S1');
});

it('after a successful reset, a later sign-out goes through (the hold is off)', async () => {
  acceptCode();
  await mount();
  await act(() => store.resetPasswordWithCode('sam@example.com', '123456', 'secret6'));
  for (let i = 0; i < 3; i++) await act(async () => {});
  expect(store.session?.user.id).toBe('S1');
  await act(async () => mockAuth.listener?.('SIGNED_OUT', null));
  expect(store.session).toBeNull();
  expect(store.currentUser).toBeNull();
});

