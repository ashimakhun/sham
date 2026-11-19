// ARU-166 QA: the real StoreProvider against a fake Supabase client, for cases the dev tests leave out: notifications
// turned off in the phone's settings remove the registration on the next open (AC 3), a never-asked phone calls
// nothing (AC 1), a registration sends only the install id, token and platform (AC 2), a waiting account that gets
// approved registers (AC 5), and sign-out unregisters the same install id that was registered (AC 4).
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

const pushRpcs = () => mockState.rpcs.filter((r) => r.name.includes('push_device'));

it('AC 3: notifications turned off for Sham in the phone settings → the next open removes this phone, registers nothing', async () => {
  N.__setPermission({ status: 'denied', ios: { status: 1 } });
  await mount();
  expect(pushRpcs().map((r) => r.name)).toEqual(['unregister_push_device']);
  expect((Notifications.requestPermissionsAsync as jest.Mock)).not.toHaveBeenCalled();
});

it('AC 3: allowed, then turned off while Sham is in the background → coming back removes the registration', async () => {
  await mount();
  expect(registrations()).toHaveLength(1);
  N.__setPermission({ status: 'denied', ios: { status: 1 } });
  await act(async () => {
    appStateListeners.forEach((l) => l('active'));
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
  expect(pushRpcs().at(-1)?.name).toBe('unregister_push_device');
  expect(registrations()).toHaveLength(1);
});

it('AC 1: never asked on this phone → app open calls neither register nor unregister', async () => {
  N.__reset();
  await mount();
  expect(pushRpcs()).toEqual([]);
});

it('AC 2: a registration sends only the install id, the Expo token and the platform (no name, email, phone or model)', async () => {
  await mount();
  const args = registrations()[0].args as Record<string, string>;
  expect(Object.keys(args).sort()).toEqual(['device', 'platform', 'token']);
  expect(args.device).toMatch(/^[0-9a-f-]{8,}$/i);
  expect(JSON.stringify(args)).not.toMatch(/@|full_name|student/i);
});

it('AC 4: sign-out unregisters the same install id this phone registered with', async () => {
  await mount();
  const device = (registrations()[0].args as Record<string, string>).device;
  await act(async () => {
    await store.signOut();
  });
  expect(mockState.rpcs.filter((r) => r.name === 'unregister_push_device').at(-1)?.args).toEqual({ device });
});

it('AC 5: a waiting account that gets approved registers on the next return to the foreground', async () => {
  mockState.profiles = [{ id: 'S', full_name: 'S', role: 'student', access_status: 'pending' }];
  await mount();
  expect(registrations()).toHaveLength(0);
  mockState.profiles = [{ id: 'S', full_name: 'S', role: 'student', access_status: 'approved' }];
  await act(async () => {
    await store.refresh();
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
  await act(async () => {
    appStateListeners.forEach((l) => l('active'));
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
  expect(registrations().length).toBeGreaterThanOrEqual(1);
});
