// ARU-180: the real StoreProvider against a fake Supabase client. deleteWorkspace() calls the delete-account Edge
// Function with the typed workspace name, shows the function's message on failure (AC 4, 12) and signs out with "Your
// account and workspace were deleted" on success (AC 5). The teacher's other device signs out with the same notice,
// and a member whose workspace was deleted gets the deactivated status with this phone's reminders cancelled (AC 10).
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { ACCOUNT_DELETED, DELETE_OFFLINE, WORKSPACE_DELETE_FAILED, WORKSPACE_DELETED, WRONG_PASSWORD } from '@/lib/deleteAccount';
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

const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => body },
});
const userGone = { data: { user: null }, error: { status: 403, code: 'user_not_found', message: 'User from sub claim in JWT does not exist' } };

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

it('AC5: sends the password and the typed name, then signs out on this device with the workspace notice', async () => {
  mockState.invoke.mockResolvedValue({ data: { deleted: true, files: 3, workspace: true }, error: null });
  await mount();
  await act(() => store.deleteWorkspace(' sham ', 'secret1'));
  expect(mockState.invoke).toHaveBeenCalledWith('delete-account', { body: { password: 'secret1', workspace_name: ' sham ' } });
  expect(cancelAllReminders).toHaveBeenCalled();
  expect(mockState.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(store.session).toBeNull();
  expect(store.accountNotice).toBe(WORKSPACE_DELETED);
});

it.each([
  ['AC4 wrong password', httpError(403, { error: WRONG_PASSWORD, code: 'wrong_password' }), WRONG_PASSWORD],
  ['name mismatch', httpError(403, { error: "The workspace name doesn't match." }), "The workspace name doesn't match."],
  ['AC12 a server error', httpError(500, { error: WORKSPACE_DELETE_FAILED }), WORKSPACE_DELETE_FAILED],
  ['AC12 an unreadable answer', { name: 'FunctionsHttpError', context: { json: async () => Promise.reject(new Error('html')) } }, WORKSPACE_DELETE_FAILED],
  ['AC12 offline', { name: 'FunctionsFetchError', message: 'Failed to send a request' }, DELETE_OFFLINE],
])('%s: throws the message and stays signed in', async (_name, error, message) => {
  mockState.invoke.mockResolvedValue({ data: null, error });
  await mount();
  await act(async () => {
    await expect(store.deleteWorkspace('Sham', 'pw')).rejects.toThrow(message);
  });
  expect(mockState.signOut).not.toHaveBeenCalled();
  expect(store.accountNotice).toBeNull();
  expect(store.currentUser?.name).toBe('Teacher Tess');
});

it('an answer lost after the deletion: signs out with the workspace notice instead of an error', async () => {
  mockState.invoke.mockResolvedValue({ data: null, error: httpError(401, { error: 'Not signed in.' }) });
  await mount();
  mockState.getUser.mockResolvedValue(userGone);
  await act(() => store.deleteWorkspace('Sham', 'pw'));
  expect(mockState.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(store.accountNotice).toBe(WORKSPACE_DELETED);
});

it('AC2: the summary comes from workspace_deletion_summary()', async () => {
  await mount();
  mockState.rpc.mockImplementation(async (fn: string) =>
    fn === 'workspace_deletion_summary' ? { data: [{ name: 'Sham', other_accounts: 5 }], error: null } : { data: [], error: null },
  );
  await expect(store.getWorkspaceDeletionSummary()).resolves.toEqual({ name: 'Sham', otherAccounts: 5 });
  mockState.rpc.mockResolvedValue({ data: [], error: null });
  await expect(store.getWorkspaceDeletionSummary()).resolves.toBeNull();
});

describe('AC10: devices already signed in', () => {
  it("the teacher's other device, back in the foreground: signed out with the workspace notice", async () => {
    await mount();
    mockState.getUser.mockResolvedValue(userGone);
    await act(async () => comeBack());
    await act(async () => {});
    expect(mockState.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(store.accountNotice).toBe(WORKSPACE_DELETED);
  });

  it('a teacher who created the workspace, on a fresh start (profile already gone): the workspace notice', async () => {
    mockState.meta = { workspace_name: 'Sham' };
    mockState.profiles = [];
    mockState.getUser.mockResolvedValue(userGone);
    await mount();
    expect(store.accountNotice).toBe(WORKSPACE_DELETED);
  });

  it('a student deleted elsewhere still gets "Your account was deleted" (ARU-75)', async () => {
    mockState.me = 'S1';
    mockState.profiles = [{ id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' }];
    await mount();
    mockState.getUser.mockResolvedValue(userGone);
    await act(async () => comeBack());
    await act(async () => {});
    expect(store.accountNotice).toBe(ACCOUNT_DELETED);
  });

  it('a member whose workspace was deleted: deactivated, reminders cancelled, not signed out', async () => {
    mockState.me = 'S1';
    mockState.getUser.mockResolvedValue({ data: { user: { id: 'S1' } }, error: null });
    mockState.profiles = [{ id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'deactivated', workspace_id: null }];
    await mount();
    expect(store.currentUser?.accessStatus).toBe('deactivated');
    expect(cancelAllReminders).toHaveBeenCalled();
    expect(mockState.signOut).not.toHaveBeenCalled();
    // AC 9: no push device is registered for it.
    expect(mockState.rpc).not.toHaveBeenCalledWith('register_push_device', expect.anything());
  });
});
