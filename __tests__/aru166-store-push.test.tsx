// ARU-166: the real StoreProvider against a fake Supabase client: this phone is registered on app open and on every
// return to the foreground (AC 2), Sign out removes the registration first and still signs out offline (AC 4), and
// the switches read "all on" without a row and save through set_notification (AC 8).
import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  me: 'S',
  profiles: [] as Record<string, unknown>[],
  settings: [] as Record<string, unknown>[],
  calls: [] as string[],
  rpcs: [] as { name: string; args: unknown }[],
  failRpc: null as string | null,
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({
        data: table === 'profiles' ? mockState.profiles : table === 'notification_settings' ? mockState.settings : [],
        error: null,
      });
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
        getSession: () => ok({ session: { user: { id: mockState.me } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: () => ok({ user: { id: mockState.me } }),
        signOut: () => {
          mockState.calls.push('auth.signOut');
          return Promise.resolve({ error: null });
        },
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        mockState.rpcs.push({ name, args });
        mockState.calls.push(name);
        if (name === mockState.failRpc) return Promise.reject(new TypeError('Network request failed'));
        return ok(name.endsWith('unread_counts') || name.endsWith('unread_count') ? [] : null);
      },
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

const N = Notifications as unknown as { __setPermission: (p: Record<string, unknown>) => void; __reset: () => void };

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.users.length}</Text>;
}
async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  for (let i = 0; i < 4; i++) await act(async () => {});
}
const registrations = () => mockState.rpcs.filter((r) => r.name === 'register_push_device');

let appStateListeners: ((s: string) => void)[] = [];
beforeEach(() => {
  N.__reset();
  N.__setPermission({ status: 'granted', ios: { status: 2 } });
  mockState.me = 'S';
  mockState.profiles = [{ id: 'S', full_name: 'S', role: 'student', access_status: 'approved' }];
  mockState.settings = [];
  mockState.calls = [];
  mockState.rpcs = [];
  mockState.failRpc = null;
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(() => jest.restoreAllMocks());

it('AC 2: an approved account registers this phone on app open and again on returning to the foreground', async () => {
  await mount();
  expect(registrations()).toHaveLength(1);
  expect(registrations()[0].args).toMatchObject({ token: 'ExponentPushToken[test-token]', platform: 'ios' });
  await act(async () => {
    appStateListeners.forEach((l) => l('active'));
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
  expect(registrations().length).toBeGreaterThanOrEqual(2);
});

it('AC 1: opening the app never asks for permission', async () => {
  N.__reset();
  await mount();
  expect((Notifications.requestPermissionsAsync as jest.Mock)).not.toHaveBeenCalled();
  expect(registrations()).toHaveLength(0);
});

it('AC 5: a waiting account registers nothing', async () => {
  mockState.profiles = [{ id: 'S', full_name: 'S', role: 'student', access_status: 'pending' }];
  await mount();
  expect(mockState.rpcs.filter((r) => r.name.includes('push_device'))).toEqual([]);
});

it('AC 4: Sign out removes this phone\'s registration first, then signs out', async () => {
  await mount();
  mockState.calls = [];
  await act(async () => {
    await store.signOut();
  });
  expect(mockState.calls).toEqual(['unregister_push_device', 'auth.signOut']);
});

it('AC 4: offline, sign-out still happens', async () => {
  await mount();
  mockState.failRpc = 'unregister_push_device';
  mockState.calls = [];
  await act(async () => {
    await store.signOut();
  });
  expect(mockState.calls).toEqual(['unregister_push_device', 'auth.signOut']);
});

it('AC 8: no settings row reads as all on; a flip saves through set_notification', async () => {
  await mount();
  await act(async () => {
    await store.loadNotificationSettings();
  });
  expect(Object.values(store.notificationSettings ?? {})).toHaveLength(10);
  expect(Object.values(store.notificationSettings ?? {}).every(Boolean)).toBe(true);
  await act(async () => {
    await store.setNotification('chat_message', false);
  });
  expect(mockState.rpcs.at(-1)).toEqual({ name: 'set_notification', args: { kind: 'chat_message', enabled: false } });
  expect(store.notificationSettings?.chat_message).toBe(false);
  expect(store.notificationSettings?.general_chat).toBe(true);
});

it('AC 8: a saved row is read', async () => {
  mockState.settings = [{ user_id: 'S', notify_meeting_started: false, notify_chat_message: true }];
  await mount();
  await act(async () => {
    await store.loadNotificationSettings();
  });
  expect(store.notificationSettings?.meeting_started).toBe(false);
  expect(store.notificationSettings?.chat_message).toBe(true);
});
