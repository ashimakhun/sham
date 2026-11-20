// ARU-166: push setup on the phone (src/lib/push.ts), the Notifications page and Profile's Notifications button.
// expo-notifications is the Jest stand-in from jest.setup.js.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import NotificationsScreen from '@/app/notifications';
import en from '@/i18n/en.json';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';
import {
  askPushPermission,
  installId,
  pushPermission,
  pushSupported,
  showPushesInForeground,
  syncPushRegistration,
  unregisterThisPhone,
} from '@/lib/push';
import type { NotificationKind } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const N = Notifications as unknown as {
  __setPermission: (p: Record<string, unknown>) => void;
  __setAnswer: (p: Record<string, unknown> | null) => void;
  __reset: () => void;
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  setNotificationChannelAsync: jest.Mock;
  getExpoPushTokenAsync: jest.Mock;
  setNotificationHandler: jest.Mock;
};
const IOS = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 };
const originalOS = Platform.OS;
const originalEnv = Constants.executionEnvironment;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
const setExpoGo = (on: boolean) =>
  Object.defineProperty(Constants, 'executionEnvironment', {
    configurable: true,
    value: on ? ExecutionEnvironment.StoreClient : ExecutionEnvironment.Standalone,
  });
const rpc = () => jest.fn(async (_fn: string, _args: Record<string, string>) => ({ error: null }));

beforeEach(async () => {
  jest.clearAllMocks();
  N.__reset();
  setOS('ios');
  setExpoGo(false);
  await AsyncStorage.clear();
});
afterAll(() => {
  setOS(originalOS);
  Object.defineProperty(Constants, 'executionEnvironment', { configurable: true, value: originalEnv });
});

describe('push.ts', () => {
  it('AC 6: not supported in Expo Go or on the web; nothing asks or registers there', async () => {
    setExpoGo(true);
    expect(pushSupported()).toBe(false);
    expect(await askPushPermission()).toBe('unsupported');
    setExpoGo(false);
    setOS('web');
    expect(pushSupported()).toBe(false);
    const call = rpc();
    await syncPushRegistration(call, true);
    await unregisterThisPhone(call);
    expect(call).not.toHaveBeenCalled();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    setOS('android');
    expect(pushSupported()).toBe(true);
  });

  it('AC 1 (Android): the General channel is created before the prompt', async () => {
    setOS('android');
    const order: string[] = [];
    N.setNotificationChannelAsync.mockImplementationOnce(async (id: string, ch: { name: string }) => {
      order.push(`channel ${id} ${ch.name}`);
      return null;
    });
    N.requestPermissionsAsync.mockImplementationOnce(async () => {
      order.push('prompt');
      return { status: 'granted', granted: true, canAskAgain: true };
    });
    expect(await askPushPermission()).toBe('granted');
    expect(order).toEqual(['channel default General', 'prompt']);
  });

  it('AC 1: asks only when never asked; an answered permission is never asked again', async () => {
    N.__setPermission({ status: 'denied', ios: { status: IOS.DENIED } });
    expect(await askPushPermission()).toBe('denied');
    N.__setPermission({ status: 'granted', ios: { status: IOS.AUTHORIZED } });
    expect(await askPushPermission()).toBe('granted');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    N.__reset();
    N.__setAnswer({ status: 'denied', ios: { status: IOS.DENIED } });
    expect(await askPushPermission()).toBe('denied');
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(N.requestPermissionsAsync.mock.calls[0][0]).toEqual({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  });

  it('edge: iOS reads the iOS field; provisional counts as allowed', async () => {
    N.__setPermission({ status: 'denied', ios: { status: IOS.PROVISIONAL } });
    expect(await pushPermission()).toBe('granted');
    N.__setPermission({ status: 'undetermined', ios: { status: IOS.NOT_DETERMINED } });
    expect(await pushPermission()).toBe('undetermined');
  });

  it('the install id is random, kept, and the same on every call', async () => {
    const a = await installId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(await installId()).toBe(a);
  });

  it('AC 2: allowed → registers only the install id, the Expo token and the platform', async () => {
    N.__setPermission({ status: 'granted', ios: { status: IOS.AUTHORIZED } });
    const call = rpc();
    await syncPushRegistration(call, true);
    const device = await installId();
    expect(call.mock.calls).toEqual([
      ['register_push_device', { device, token: 'ExponentPushToken[test-token]', platform: 'ios' }],
    ]);
    // The token is for the EAS project in app.json (whatever the runtime config carries under Jest).
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith(projectId ? { projectId } : undefined);
    expect(require('../app.json').expo.extra.eas.projectId).toBe('e8530336-5f9e-4177-96d7-853d95d227cc');
    expect(require('../app.json').expo.plugins).toContainEqual(['expo-notifications', { defaultChannel: 'default' }]);
    // A changed token is registered for the same install id (the server replaces the old one).
    N.getExpoPushTokenAsync.mockResolvedValueOnce({ type: 'expo', data: 'ExponentPushToken[new]' });
    await syncPushRegistration(call, true);
    expect(call.mock.calls[1]).toEqual(['register_push_device', { device, token: 'ExponentPushToken[new]', platform: 'ios' }]);
  });

  it('AC 3: declined or turned off → removes this phone\'s registration; never asked → nothing', async () => {
    const call = rpc();
    await syncPushRegistration(call, true);
    expect(call).not.toHaveBeenCalled();
    N.__setPermission({ status: 'denied', ios: { status: IOS.DENIED } });
    await syncPushRegistration(call, true);
    expect(call.mock.calls).toEqual([['unregister_push_device', { device: await installId() }]]);
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('AC 5: a waiting or declined account registers nothing', async () => {
    N.__setPermission({ status: 'granted', ios: { status: IOS.AUTHORIZED } });
    const call = rpc();
    await syncPushRegistration(call, false);
    expect(call).not.toHaveBeenCalled();
  });

  it('edge: no token (offline) or a refused call never throws', async () => {
    N.__setPermission({ status: 'granted', ios: { status: IOS.AUTHORIZED } });
    N.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('offline'));
    const call = rpc();
    await expect(syncPushRegistration(call, true)).resolves.toBeUndefined();
    expect(call).not.toHaveBeenCalled();
    await expect(syncPushRegistration(jest.fn().mockRejectedValue(new Error('x')), true)).resolves.toBeUndefined();
  });

  it('AC 4: unregistering on sign-out gives up after the timeout (offline) without throwing', async () => {
    const never = jest.fn(() => new Promise<{ error: unknown }>(() => {}));
    await expect(unregisterThisPhone(never, 10)).resolves.toBeUndefined();
    expect(never).toHaveBeenCalledWith('unregister_push_device', { device: await installId() });
  });

  it('AC 12: pushes show as a banner while the app is open (sound on, no badge)', async () => {
    showPushesInForeground();
    showPushesInForeground();
    expect(N.setNotificationHandler).toHaveBeenCalledTimes(1);
    const { handleNotification } = N.setNotificationHandler.mock.calls[0][0];
    expect(await handleNotification({})).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });
});

describe('Profile → Notifications (AC 7)', () => {
  it.each(['S1', 'M', 'T'] as const)('%s: "Notifications >" opens the page; no Telegram button', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Telegram notifications' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Notifications' }));
    expect(router.push).toHaveBeenCalledWith('/notifications');
  });
});

const labels = () => screen.queryAllByRole('switch').map((s) => s.props.accessibilityLabel);
async function renderPage(store = fakeStore('S1')) {
  setStore(store);
  const view = await render(<NotificationsScreen />);
  await act(async () => {});
  await act(async () => {});
  return { view, store };
}

describe('Notifications page', () => {
  it.each([
    ['T', ['Homework submitted', 'Chat messages', 'General chat', 'New materials', 'Meeting notes', 'New accounts']],
    [
      'M',
      // ARU-170 AC 9: Homework due soon right after New homework.
      ['Meeting started', 'New homework', 'Homework due soon', 'Homework reviewed', 'Photo deletion', 'Homework submitted', 'Chat messages', 'General chat', 'New materials', 'Meeting notes'],
    ],
    ['S1', ['Meeting started', 'New homework', 'Homework due soon', 'Homework reviewed', 'Photo deletion', 'Chat messages', 'General chat', 'New materials', 'Meeting notes']],
  ] as const)('AC 7: %s sees today\'s switches, in today\'s order', async (who, expected) => {
    await renderPage(fakeStore(who));
    expect(labels()).toEqual(expected);
  });

  it('AC 8: no settings row → every switch on, no error', async () => {
    await renderPage(fakeStore('S1', { notificationSettings: undefined }));
    expect(screen.getAllByRole('switch').every((s) => s.props.value === true)).toBe(true);
    expect(screen.queryByText(/Could not/)).toBeNull();
  });

  it('AC 8: saved values show; a flip saves at once', async () => {
    const settings = { chat_message: false } as Record<NotificationKind, boolean>;
    const { store } = await renderPage(fakeStore('S1', { notificationSettings: settings }));
    const chat = screen.getByRole('switch', { name: 'Chat messages' });
    expect(chat.props.value).toBe(false);
    await fireEvent(screen.getByRole('switch', { name: 'General chat' }), 'valueChange', false);
    expect(store.setNotification).toHaveBeenCalledWith('general_chat', false);
  });

  it('AC 8: saving fails → the switch flips back and "Could not save. Please try again." shows', async () => {
    const store = fakeStore('S1', { setNotification: jest.fn().mockRejectedValue(new Error('offline')) });
    await renderPage(store);
    await fireEvent(screen.getByRole('switch', { name: 'Chat messages' }), 'valueChange', false);
    await act(async () => {});
    expect(screen.getByText('Could not save. Please try again.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Chat messages' }).props.value).toBe(true);
  });

  it('AC 1 / AC 2: the first open asks once, then registers this phone; reopening doesn\'t ask again', async () => {
    const { store } = await renderPage();
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(store.syncPushDevice).toHaveBeenCalled();
    expect(store.loadNotificationSettings).toHaveBeenCalled();
    await refocus();
    await act(async () => {});
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('notifications-off')).toBeNull();
  });

  it('AC 3: declined → the notice and Open settings; switches still save', async () => {
    N.__setAnswer({ status: 'denied', ios: { status: IOS.DENIED } });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { store } = await renderPage();
    expect(screen.getByText("Notifications are off for Sham in your phone's settings")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open settings' }));
    expect(openSettings).toHaveBeenCalled();
    await fireEvent(screen.getByRole('switch', { name: 'Chat messages' }), 'valueChange', false);
    expect(store.setNotification).toHaveBeenCalledWith('chat_message', false);
    openSettings.mockRestore();
  });

  it('AC 6: Expo Go / web: the installed-app notice above the switches, no prompt, no registration', async () => {
    setExpoGo(true);
    const { view, store } = await renderPage();
    expect(screen.getByText('Notifications work in the installed Sham app.')).toBeTruthy();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(store.syncPushDevice).not.toHaveBeenCalled();
    const json = JSON.stringify(view.toJSON());
    expect(json.indexOf('Notifications work in the installed Sham app.')).toBeLessThan(json.indexOf('Meeting started'));
    // ARU-170 AC 9: 8 + Homework due soon.
    expect(labels()).toHaveLength(9);
  });

  it('AC 1: with the prompt never answered (e.g. dismissed), turning a switch on asks', async () => {
    // The first open's request leaves it undetermined (the person closed the app before answering).
    N.__setAnswer({ status: 'undetermined', ios: { status: IOS.NOT_DETERMINED } });
    await renderPage(fakeStore('S1', { notificationSettings: { chat_message: false } as Record<NotificationKind, boolean> }));
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    N.__setAnswer(null);
    await fireEvent(screen.getByRole('switch', { name: 'Chat messages' }), 'valueChange', true);
    await act(async () => {});
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(2);
  });
});

describe('AC 14: texts', () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('notifications.'));
  it('every new key has English, Russian and a note', () => {
    expect(keys.length).toBeGreaterThanOrEqual(7);
    for (const k of keys) {
      expect((ru as Record<string, string>)[k]).toBeTruthy();
      expect((notes as Record<string, string>)[k]).toBeTruthy();
    }
  });
});
