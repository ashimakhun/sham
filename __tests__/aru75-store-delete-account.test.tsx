// ARU-75: the real StoreProvider against a fake Supabase client: deleteAccount() calls the delete-account Edge
// Function, shows the function's message on failure (AC 3, 6, 12), signs out locally with "Your account was deleted"
// on success (AC 4), and on start / return to the app signs out a user who no longer exists (AC 9).
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { ACCOUNT_DELETED, DELETE_OFFLINE, WRONG_PASSWORD } from '@/lib/deleteAccount';
import { StoreProvider, useStore } from '@/lib/store';

type AuthListener = (event: string, session: unknown) => void;
const mockState = {
  invoke: jest.fn(),
  getUser: jest.fn(),
  signOut: jest.fn(),
  listeners: [] as AuthListener[],
  profiles: [] as Record<string, unknown>[],
};

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
        getSession: () => ok({ session: { user: { id: 'S1' } } }),
        onAuthStateChange: (cb: AuthListener) => {
          mockState.listeners.push(cb);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        getUser: (...args: unknown[]) => mockState.getUser(...args),
        signOut: (...args: unknown[]) => mockState.signOut(...args),
      },
      functions: { invoke: (...args: unknown[]) => mockState.invoke(...args) },
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

const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => body },
});
const userGone = { data: { user: null }, error: { status: 403, code: 'user_not_found', message: 'User from sub claim in JWT does not exist' } };

let appStateListeners: ((s: string) => void)[] = [];
const comeBack = () => appStateListeners.forEach((l) => l('active'));

beforeEach(() => {
  mockState.invoke.mockReset();
  mockState.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'S1' } }, error: null });
  mockState.signOut.mockReset().mockImplementation(async () => {
    for (const l of mockState.listeners) l('SIGNED_OUT', null);
    return { error: null };
  });
  mockState.listeners = [];
  mockState.profiles = [{ id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' }];
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    appStateListeners.push(cb as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => jest.restoreAllMocks());

it('AC4: calls delete-account with the password, then signs out on this device with the notice', async () => {
  mockState.invoke.mockResolvedValue({ data: { deleted: true, files: 2 }, error: null });
  await mount();
  await act(() => store.deleteAccount('secret1'));
  expect(mockState.invoke).toHaveBeenCalledWith('delete-account', { body: { password: 'secret1' } });
  expect(mockState.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(store.session).toBeNull();
  expect(store.accountNotice).toBe(ACCOUNT_DELETED);
});

it.each([
  ['AC3 wrong password', httpError(403, { error: WRONG_PASSWORD, code: 'wrong_password' }), WRONG_PASSWORD],
  [
    'AC6 course owner',
    httpError(403, { error: 'You own courses: Algebra. Ask the teacher or a mentor to change their owner first.' }),
    'You own courses: Algebra. Ask the teacher or a mentor to change their owner first.',
  ],
  ['AC12 a server error', httpError(500, { error: "Your account couldn't be deleted. Please try again." }), "Your account couldn't be deleted. Please try again."],
  ['AC12 an unreadable answer', { name: 'FunctionsHttpError', context: { json: async () => Promise.reject(new Error('html')) } }, "Your account couldn't be deleted. Please try again."],
  ['AC12 offline', { name: 'FunctionsFetchError', message: 'Failed to send a request' }, DELETE_OFFLINE],
])('%s: throws the message and stays signed in', async (_name, error, message) => {
  mockState.invoke.mockResolvedValue({ data: null, error });
  await mount();
  await act(async () => {
    await expect(store.deleteAccount('pw')).rejects.toThrow(message);
  });
  expect(mockState.signOut).not.toHaveBeenCalled();
  expect(store.accountNotice).toBeNull();
  expect(store.currentUser?.name).toBe('Student Sam');
});

it('AC12 the request itself throwing (offline): the offline message', async () => {
  mockState.invoke.mockRejectedValue(new TypeError('Network request failed'));
  await mount();
  await act(async () => {
    await expect(store.deleteAccount('pw')).rejects.toThrow(DELETE_OFFLINE);
  });
  expect(mockState.signOut).not.toHaveBeenCalled();
});

it('an answer lost after the account was deleted: signs out with the notice instead of an error', async () => {
  mockState.invoke.mockResolvedValue({ data: null, error: httpError(401, { error: 'Not signed in.' }) });
  await mount();
  mockState.getUser.mockResolvedValue(userGone);
  await act(() => store.deleteAccount('pw'));
  expect(mockState.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(store.accountNotice).toBe(ACCOUNT_DELETED);
});

describe('AC9: another device', () => {
  it('on start: a user that no longer exists is signed out with the notice', async () => {
    mockState.getUser.mockResolvedValue(userGone);
    mockState.profiles = [];
    await mount();
    expect(mockState.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(store.session).toBeNull();
    expect(store.accountNotice).toBe(ACCOUNT_DELETED);
  });

  it('back in the foreground: checks again', async () => {
    await mount();
    expect(mockState.signOut).not.toHaveBeenCalled();
    mockState.getUser.mockResolvedValue(userGone);
    await act(async () => comeBack());
    await act(async () => {});
    expect(mockState.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(store.accountNotice).toBe(ACCOUNT_DELETED);
  });

  it('offline or another error: stays signed in', async () => {
    mockState.getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } });
    await mount();
    await act(async () => comeBack());
    expect(mockState.signOut).not.toHaveBeenCalled();
    expect(store.accountNotice).toBeNull();
  });

  it('signing in again clears the notice', async () => {
    mockState.getUser.mockResolvedValue(userGone);
    await mount();
    expect(store.accountNotice).toBe(ACCOUNT_DELETED);
    // signIn isn't mocked here: the notice is cleared before the request.
    await act(async () => {
      await store.signIn('a@b.c', 'secret1').catch(() => {});
    });
    expect(store.accountNotice).toBeNull();
  });
});
