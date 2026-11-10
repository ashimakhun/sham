// ARU-146: the real StoreProvider against a fake Supabase client. signUp sends the workspace choice in the user data,
// maps the database's refusal ("Database error saving new user") to the right text, and the teacher's load fetches
// the invite code with my_workspace_invite().
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  user: null as string | null,
  role: 'teacher',
  signUps: [] as Record<string, unknown>[],
  signUpResult: { data: { user: { identities: [{}] } }, error: null } as Record<string, unknown>,
  rpcs: [] as string[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'delete', 'update', 'limit', 'lt', 'or', 'in', 'insert']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'profiles' && mockState.user) {
        return resolve({ data: [{ id: mockState.user, full_name: 'Tia', role: mockState.role, access_status: 'approved' }], error: null });
      }
      return resolve({ data: [], error: null });
    };
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
        getSession: () => ok({ session: mockState.user ? { user: { id: mockState.user } } : null }),
        getUser: () => ok({ user: mockState.user ? { id: mockState.user } : null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signUp: (args: Record<string, unknown>) => {
          mockState.signUps.push(args);
          return Promise.resolve(mockState.signUpResult);
        },
      },
      from: (table: string) => query(table),
      rpc: (name: string) => {
        mockState.rpcs.push(name);
        if (name === 'my_workspace_invite') return ok([{ name: 'My school', invite_code: 'ABCD2345' }]);
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
  return <Text>{store.workspaceInvite?.inviteCode ?? 'none'}</Text>;
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

const refused = { data: { user: null }, error: { name: 'AuthApiError', status: 500, code: 'unexpected_failure', message: 'Database error saving new user' } };

beforeEach(() => {
  mockState.user = null;
  mockState.role = 'teacher';
  mockState.signUps = [];
  mockState.signUpResult = { data: { user: { identities: [{}] } }, error: null };
  mockState.rpcs = [];
});

it('AC 2: Create a workspace sends the trimmed name and no code', async () => {
  await mount();
  await act(() => store.signUp(' Tia ', ' tia@x.test ', 'secret1', { kind: 'create', name: '  My school ' }));
  expect(mockState.signUps).toEqual([
    { email: 'tia@x.test', password: 'secret1', options: { data: { full_name: 'Tia', workspace_name: 'My school' } } },
  ]);
});

it('AC 3 / AC 4: Join sends the code trimmed and in upper case', async () => {
  await mount();
  await act(() => store.signUp('Jo', 'jo@x.test', 'secret1', { kind: 'join', code: ' abcd2345 ' }));
  expect(mockState.signUps[0]).toEqual({
    email: 'jo@x.test',
    password: 'secret1',
    options: { data: { full_name: 'Jo', invite_code: 'ABCD2345' } },
  });
});

it('AC 4: the database refusing a Join is "No workspace has this invite code"', async () => {
  mockState.signUpResult = refused;
  await mount();
  await expect(store.signUp('Jo', 'jo@x.test', 'secret1', { kind: 'join', code: 'ZZZZZZZZ' })).rejects.toThrow(
    'No workspace has this invite code',
  );
});

it('the database refusing a Create is the generic error', async () => {
  mockState.signUpResult = refused;
  await mount();
  await expect(store.signUp('Tia', 't@x.test', 'secret1', { kind: 'create', name: 'X' })).rejects.toThrow(
    'Something went wrong. Please try again.',
  );
});

it('AC 6: an existing email keeps its own message (both answers Supabase gives)', async () => {
  mockState.signUpResult = { data: { user: null }, error: { status: 422, code: 'user_already_exists', message: 'User already registered' } };
  await mount();
  await expect(store.signUp('Jo', 'jo@x.test', 'secret1', { kind: 'join', code: 'ABCD2345' })).rejects.toThrow(
    'An account with this email already exists.',
  );
  mockState.signUpResult = { data: { user: { identities: [] } }, error: null };
  await expect(store.signUp('Jo', 'jo@x.test', 'secret1', { kind: 'create', name: 'X' })).rejects.toThrow(
    'An account with this email already exists.',
  );
});

it('AC 8: a teacher\'s load fetches the invite', async () => {
  mockState.user = 'T';
  await mount();
  expect(mockState.rpcs).toContain('my_workspace_invite');
  expect(store.workspaceInvite).toEqual({ name: 'My school', inviteCode: 'ABCD2345' });
});

it('AC 9: a student\'s load never asks for it', async () => {
  mockState.user = 'S';
  mockState.role = 'student';
  await mount();
  expect(mockState.rpcs).not.toContain('my_workspace_invite');
  expect(store.workspaceInvite).toBeNull();
});
