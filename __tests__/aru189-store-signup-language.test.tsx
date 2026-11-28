// ARU-189: the real StoreProvider against a fake Supabase client. signUp sends the picked language in the sign-up's
// user data, next to terms_version, only when one is given (AC 5 / AC 7); signIn never sends one (AC 6).
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


beforeEach(() => {
  mockState.signUps = [];
  mockState.signUpResult = { data: { user: { id: 'U', identities: [{}] } }, error: null };
  mockState.invite = [];
});

it('AC 5: a picked language goes in the user data with the account', async () => {
  await mount();
  await act(() => store.signUp('Dana', 'dana_s', 'secret1', { kind: 'join', code: 'abcd2345' }, 'ru'));
  expect(mockState.signUps).toEqual([
    {
      email: 'dana_s@users.sham.invalid',
      password: 'secret1',
      options: { data: { username: 'dana_s', full_name: 'Dana', invite_code: 'ABCD2345', terms_version: 1, language: 'ru' } },
    },
  ]);
});

it('AC 5: English too, when creating a workspace', async () => {
  await mount();
  await act(() => store.signUp('Dana', 'dana_s', 'secret1', { kind: 'create', name: 'School' }, 'en'));
  expect((mockState.signUps[0] as { options: { data: Record<string, unknown> } }).options.data.language).toBe('en');
});

it('AC 7: not touched: no language key at all', async () => {
  await mount();
  await act(() => store.signUp('Dana', 'dana_s', 'secret1', { kind: 'create', name: 'School' }));
  expect((mockState.signUps[0] as { options: { data: Record<string, unknown> } }).options.data).not.toHaveProperty('language');
});
