// ARU-76: the real StoreProvider's changePassword() against a fake Supabase Auth. The current password is checked by
// signing in again with the session's email; only then is the password updated. Errors map to the story's messages.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type AuthResult = { data: unknown; error: null | { message: string; code?: string; status?: number; name?: string } };
const mockAuth = {
  signInWithPassword: jest.fn(),
  updateUser: jest.fn(),
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
        getSession: () => ok({ session: { user: { id: 'S1', email: 'sam@example.com' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: (...a: unknown[]) => mockAuth.signInWithPassword(...a),
        updateUser: (...a: unknown[]) => mockAuth.updateUser(...a),
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
  await act(async () => {});
  await act(async () => {});
}

const signedIn: AuthResult = { data: { user: { id: 'S1' }, session: {} }, error: null };
const updated: AuthResult = { data: { user: { id: 'S1' } }, error: null };

beforeEach(() => {
  mockAuth.signInWithPassword.mockReset().mockResolvedValue(signedIn);
  mockAuth.updateUser.mockReset().mockResolvedValue(updated);
});

it('AC6: checks the current password with the session email, then sets the new one (not trimmed)', async () => {
  await mount();
  expect(store.currentUser?.id).toBe('S1');
  await act(() => store.changePassword(' old ', ' new pass '));
  expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: 'sam@example.com', password: ' old ' });
  expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: ' new pass ' });
  expect(mockAuth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(mockAuth.updateUser.mock.invocationCallOrder[0]);
});

it('AC4: new = current is refused before any request, even when the current password is wrong', async () => {
  await mount();
  await expect(store.changePassword('same12', 'same12')).rejects.toThrow('The new password must be different from the current one');
  expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
});

it('AC5: a wrong current password says so and never updates', async () => {
  mockAuth.signInWithPassword.mockResolvedValue({
    data: { user: null, session: null },
    error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 },
  });
  await mount();
  await expect(store.changePassword('wrong1', 'secret6')).rejects.toThrow('Current password is incorrect');
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
});

it.each([
  ['offline', { message: 'Network request failed', name: 'AuthRetryableFetchError', status: 0 }, 'Could not reach the server. Check your connection and try again.'],
  ['rate limit', { message: 'Request rate limit reached', code: 'over_request_rate_limit', status: 429 }, 'Too many requests. Please wait a few minutes and try again.'],
])('AC9: a %s error on the check is not shown as a wrong password', async (_case, error, message) => {
  mockAuth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error });
  await mount();
  await expect(store.changePassword('oldpass', 'secret6')).rejects.toThrow(message);
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
});

it.each([
  ['AC8 server rule', { message: 'Password should be at least 8 characters.', code: 'weak_password', status: 422 }, 'The password is too weak. Use at least 8 characters.'], // ARU-108 AC 7a
  ['AC4 same_password', { message: 'New password should be different from the old password.', code: 'same_password', status: 422 }, 'The new password must be different from the current one'],
  ['AC9 offline', { message: 'Failed to fetch', name: 'AuthRetryableFetchError', status: 0 }, 'Could not reach the server. Check your connection and try again.'],
])('%s: an update error is shown', async (_case, error, message) => {
  mockAuth.updateUser.mockResolvedValue({ data: { user: null }, error });
  await mount();
  await expect(store.changePassword('oldpass', 'secret6')).rejects.toThrow(message);
});
