// QA ARU-76: gaps in aru76-store-change-password.test.tsx: the check always runs before the update, a sign-in that
// comes back as another user never updates, sign-in errors other than wrong credentials (and the older code-less
// "Invalid login credentials" reply) map correctly, the update sends only the new password as typed, and a device
// with no session sends nothing.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockAuth = {
  session: { user: { id: 'S1', email: 'sam@example.com' } } as unknown,
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
        getSession: () => ok({ session: mockAuth.session }),
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

beforeEach(() => {
  mockAuth.session = { user: { id: 'S1', email: 'sam@example.com' } };
  mockAuth.signInWithPassword.mockReset().mockResolvedValue({ data: { user: { id: 'S1' }, session: {} }, error: null });
  mockAuth.updateUser.mockReset().mockResolvedValue({ data: { user: { id: 'S1' } }, error: null });
});

it('the current password is checked before the update, and the update sends only the new password as typed', async () => {
  await mount();
  await store.changePassword('  old  ', '      ');
  expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: 'sam@example.com', password: '  old  ' });
  expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: '      ' });
  expect(mockAuth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(mockAuth.updateUser.mock.invocationCallOrder[0]);
});

it('a sign-in that comes back as another user never updates the password', async () => {
  mockAuth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'OTHER' }, session: {} }, error: null });
  await mount();
  await expect(store.changePassword('oldpass', 'secret6')).rejects.toThrow();
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
});

it('AC5: the older code-less reply "Invalid login credentials" (400) is a wrong current password', async () => {
  mockAuth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials', status: 400 } });
  await mount();
  await expect(store.changePassword('wrong1', 'secret6')).rejects.toThrow('Current password is incorrect');
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
});

it.each([
  ['a server error', { message: 'Database error querying schema', code: 'unexpected_failure', status: 500 }],
  ['email not confirmed', { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 }],
])('%s on the check is shown as it is, never as a wrong password; nothing updated', async (_k, error) => {
  mockAuth.signInWithPassword.mockResolvedValue({ data: {}, error });
  await mount();
  await expect(store.changePassword('oldpass', 'secret6')).rejects.toThrow(error.message);
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
});

it('AC8: a rate limit on the update shows the rate-limit message', async () => {
  mockAuth.updateUser.mockResolvedValue({ data: {}, error: { message: 'rate', code: 'over_request_rate_limit', status: 429 } });
  await mount();
  await expect(store.changePassword('oldpass', 'secret6')).rejects.toThrow('Too many requests. Please wait a few minutes and try again.');
});

it('no session on this device: nothing is sent', async () => {
  mockAuth.session = null;
  await mount();
  await expect(store.changePassword('oldpass', 'secret6')).rejects.toThrow();
  expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
});
