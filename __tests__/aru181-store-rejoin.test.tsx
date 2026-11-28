// ARU-181: the real StoreProvider against a fake Supabase client. rejoinWorkspace() calls rejoin_workspace() (join,
// code trimmed and upper-cased) or create_my_workspace() (create, name trimmed), then reloads so the gate shows the
// new status. Errors: the database's message (AC 4, AC 5), offline (AC 9), "already in a workspace" reloads first
// (AC 10). A second deactivation in the same session cancels this phone's reminders again (analysis note 5).
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { INVITE_CODE_UNKNOWN, NETWORK_ERROR } from '@/lib/password';
import { StoreProvider, useStore } from '@/lib/store';

type AuthListener = (event: string, session: unknown) => void;
const mockState = {
  invoke: jest.fn(),
  getUser: jest.fn(),
  signOut: jest.fn(),
  rpc: jest.fn(),
  listeners: [] as AuthListener[],
  profiles: [] as Record<string, unknown>[],
  meta: {} as Record<string, unknown>,
  me: 'T',
};

jest.mock('@/lib/reminderScheduler', () => ({
  cancelAllReminders: jest.fn(async () => {}),
  syncReminders: jest.fn(async () => {}),
  remindersSupported: () => false,
}));

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'insert', 'delete', 'limit', 'lt', 'or', 'in', 'eq', 'update']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: table === 'profiles' ? mockState.profiles : [], error: null });
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: mockState.me, user_metadata: mockState.meta } } }),
        onAuthStateChange: (cb: AuthListener) => {
          mockState.listeners.push(cb);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        getUser: (...args: unknown[]) => mockState.getUser(...args),
        signOut: (...args: unknown[]) => mockState.signOut(...args),
      },
      functions: { invoke: (...args: unknown[]) => mockState.invoke(...args) },
      from: (table: string) => query(table),
      rpc: (...args: unknown[]) => mockState.rpc(...args),
      channel: () => c,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

const { cancelAllReminders } = jest.requireMock('@/lib/reminderScheduler') as { cancelAllReminders: jest.Mock };

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


let appStateListeners: ((s: string) => void)[] = [];
const comeBack = () => appStateListeners.forEach((l) => l('active'));

beforeEach(() => {
  cancelAllReminders.mockClear();
  mockState.invoke.mockReset();
  mockState.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  mockState.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'T' } }, error: null });
  mockState.signOut.mockReset().mockImplementation(async () => {
    for (const l of mockState.listeners) l('SIGNED_OUT', null);
    return { error: null };
  });
  mockState.listeners = [];
  mockState.me = 'T';
  mockState.meta = {};
  mockState.profiles = [{ id: 'T', full_name: 'Teacher Tess', role: 'teacher', access_status: 'approved' }];
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    appStateListeners.push(cb as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => jest.restoreAllMocks());

const deactivatedS1 = [{ id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'deactivated', workspace_id: null }];
const pendingS1 = [{ id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'pending', workspace_id: 'W2' }];
async function mountDeactivated() {
  mockState.me = 'S1';
  mockState.getUser.mockResolvedValue({ data: { user: { id: 'S1' } }, error: null });
  mockState.profiles = deactivatedS1;
  await mount();
  expect(store.currentUser?.accessStatus).toBe('deactivated');
}

it('AC3: Join sends the code trimmed and upper-cased, then reloads (Waiting for approval)', async () => {
  await mountDeactivated();
  mockState.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'rejoin_workspace') mockState.profiles = pendingS1;
    return { data: null, error: null };
  });
  await act(() => store.rejoinWorkspace({ kind: 'join', code: '  abcd1234 ' }));
  expect(mockState.rpc).toHaveBeenCalledWith('rejoin_workspace', { invite_code: 'ABCD1234' });
  expect(store.currentUser?.accessStatus).toBe('pending');
});

it('AC5: Create sends the name trimmed, then reloads (the tabs, as the teacher)', async () => {
  await mountDeactivated();
  mockState.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'create_my_workspace') {
      mockState.profiles = [{ id: 'S1', full_name: 'Student Sam', role: 'teacher', access_status: 'approved', workspace_id: 'W9' }];
    }
    return { data: null, error: null };
  });
  await act(() => store.rejoinWorkspace({ kind: 'create', name: ' New school ' }));
  expect(mockState.rpc).toHaveBeenCalledWith('create_my_workspace', { name: 'New school' });
  expect(store.currentUser?.accessStatus).toBe('approved');
  expect(store.currentUser?.role).toBe('teacher');
});

it.each([
  ['AC4 unknown code', { message: INVITE_CODE_UNKNOWN, code: 'P0002', hint: 'sham:invite_code_unknown' }, INVITE_CODE_UNKNOWN],
  [
    'AC5 name too long',
    { message: 'Workspace name must be 1 to 80 characters.', code: '23514', hint: 'sham:workspace_name_length' },
    'Workspace name must be 1 to 80 characters.',
  ],
  ['AC9 no answer from the server', { message: 'TypeError: Network request failed', code: '', hint: '' }, NETWORK_ERROR],
])('%s: throws the message, nothing changes', async (_name, error, message) => {
  await mountDeactivated();
  mockState.rpc.mockImplementation(async (fn: string) =>
    fn === 'rejoin_workspace' || fn === 'create_my_workspace' ? { data: null, error } : { data: [], error: null },
  );
  await act(async () => {
    await expect(store.rejoinWorkspace({ kind: 'join', code: 'zzzz9999' })).rejects.toThrow(message);
  });
  expect(store.currentUser?.accessStatus).toBe('deactivated');
});

it('AC9 offline (the call itself fails): the network message', async () => {
  await mountDeactivated();
  mockState.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'create_my_workspace') throw new Error('Network request failed');
    return { data: [], error: null };
  });
  await act(async () => {
    await expect(store.rejoinWorkspace({ kind: 'create', name: 'x' })).rejects.toThrow(NETWORK_ERROR);
  });
});

it('AC10: already in a workspace: reloads to the current status, then throws the message', async () => {
  await mountDeactivated();
  mockState.rpc.mockImplementation(async (fn: string) =>
    fn === 'create_my_workspace'
      ? { data: null, error: { message: 'You already belong to a workspace.', code: '55000', hint: 'sham:workspace_already_member' } }
      : { data: [], error: null },
  );
  // Joined on another device meanwhile.
  mockState.profiles = pendingS1;
  await act(async () => {
    await expect(store.rejoinWorkspace({ kind: 'create', name: 'x' })).rejects.toThrow('You already belong to a workspace.');
  });
  expect(store.currentUser?.accessStatus).toBe('pending');
});

it('note 5: deactivated again later in the same session cancels the reminders again', async () => {
  await mountDeactivated();
  expect(cancelAllReminders).toHaveBeenCalledTimes(1);
  mockState.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'rejoin_workspace') mockState.profiles = pendingS1;
    return { data: null, error: null };
  });
  await act(() => store.rejoinWorkspace({ kind: 'join', code: 'ABCD1234' }));
  mockState.profiles = deactivatedS1;
  await act(() => store.refresh());
  expect(cancelAllReminders).toHaveBeenCalledTimes(2);
});
