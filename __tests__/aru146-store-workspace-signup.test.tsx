// ARU-146: the real StoreProvider against a fake Supabase client. signUp sends the workspace choice in the sign-up's
// user data; a refusal by the database reads "No workspace has this invite code" when joining and the generic text
// when creating; getWorkspaceInvite() maps my_workspace_invite().
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  signUps: [] as unknown[],
  signUpResult: { data: { user: { id: 'U', identities: [{}] } }, error: null } as { data: unknown; error: unknown },
  invite: [] as unknown[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'delete', 'update', 'eq', 'limit', 'lt', 'or', 'in', 'order']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signUp: (args: unknown) => {
          mockState.signUps.push(args);
          return Promise.resolve(mockState.signUpResult);
        },
      },
      from: () => query(),
      rpc: (name: string) => ok(name === 'my_workspace_invite' ? mockState.invite : []),
      channel: () => c,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>probe</Text>;
}
async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await act(async () => {});
}

const refused = { message: 'Database error saving new user', status: 500, code: 'unexpected_failure', name: 'AuthApiError' };

beforeEach(() => {
  mockState.signUps = [];
  mockState.signUpResult = { data: { user: { id: 'U', identities: [{}] } }, error: null };
  mockState.invite = [];
});

it('AC 2: creating sends the trimmed workspace name with the full name', async () => {
  await mount();
  await act(() => store.signUp(' Dana ', ' d@x.kz ', 'secret1', { kind: 'create', name: '  My school ' }));
  expect(mockState.signUps).toEqual([
    { email: 'd@x.kz', password: 'secret1', options: { data: { full_name: 'Dana', workspace_name: 'My school' } } },
  ]);
});

it('AC 3 / AC 4: joining sends the code trimmed, in upper case', async () => {
  await mount();
  await act(() => store.signUp('Dana', 'd@x.kz', 'secret1', { kind: 'join', code: ' abcd2345 ' }));
  expect(mockState.signUps).toEqual([
    { email: 'd@x.kz', password: 'secret1', options: { data: { full_name: 'Dana', invite_code: 'ABCD2345' } } },
  ]);
});

it('AC 4: the database refusing a join reads "No workspace has this invite code."', async () => {
  await mount();
  mockState.signUpResult = { data: { user: null }, error: refused };
  await expect(store.signUp('D', 'd@x.kz', 'secret1', { kind: 'join', code: 'ZZZZZZZZ' })).rejects.toThrow(
    'No workspace has this invite code.',
  );
});

it('a refused create reads the generic text, not the raw server text', async () => {
  await mount();
  mockState.signUpResult = { data: { user: null }, error: refused };
  await expect(store.signUp('D', 'd@x.kz', 'secret1', { kind: 'create', name: 'S' })).rejects.toThrow(
    'Something went wrong. Please try again.',
  );
});

it('AC 6: an existing email keeps its message, in both modes', async () => {
  await mount();
  mockState.signUpResult = { data: { user: null }, error: { message: 'User already registered', status: 422, code: 'user_already_exists' } };
  await expect(store.signUp('D', 'd@x.kz', 'secret1', { kind: 'create', name: 'S' })).rejects.toThrow(
    'An account with this email already exists.',
  );
  await expect(store.signUp('D', 'd@x.kz', 'secret1', { kind: 'join', code: 'ABCD2345' })).rejects.toThrow(
    'An account with this email already exists.',
  );
  // With email confirmation on: a user with no identities.
  mockState.signUpResult = { data: { user: { id: 'U', identities: [] } }, error: null };
  await expect(store.signUp('D', 'd@x.kz', 'secret1', { kind: 'join', code: 'ABCD2345' })).rejects.toThrow(
    'An account with this email already exists.',
  );
});

it('offline keeps the network message when joining', async () => {
  await mount();
  mockState.signUpResult = { data: { user: null }, error: { message: 'Failed to fetch', status: 0, name: 'AuthRetryableFetchError' } };
  await expect(store.signUp('D', 'd@x.kz', 'secret1', { kind: 'join', code: 'ABCD2345' })).rejects.toThrow(
    /Could not reach the server/,
  );
});

it('AC 8 / AC 9: getWorkspaceInvite maps the row, or null when the database returns none', async () => {
  await mount();
  expect(await store.getWorkspaceInvite()).toBeNull();
  mockState.invite = [{ name: 'Sham', invite_code: 'ABCD2345' }];
  expect(await store.getWorkspaceInvite()).toEqual({ name: 'Sham', code: 'ABCD2345' });
});
