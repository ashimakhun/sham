// ARU-166: push notifications on this phone. The permission prompt, the Android channel, this phone's registration
// (a random install id, the Expo push token and the platform; nothing else) and the foreground handler.
// Push needs an installed Sham build (development or store build): in Expo Go and on the web nothing here asks,
// registers or throws (AC 6).
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { Platform } from 'react-native';

import { newId } from './id';

/** The Android channel every push uses (the Edge Functions send channelId 'default'); shown as "General". */
export const ANDROID_CHANNEL_ID = 'default';
const INSTALL_ID_KEY = 'sham.pushInstallId';

/** AC 6: push works only in an installed build on iOS or Android, not in Expo Go or on the web. */
export function pushSupported(): boolean {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  // Expo Go is the "store client": it can't receive Sham's pushes (Android since SDK 53).
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

/** granted: Sham may notify; undetermined: never asked on this phone; denied: declined or turned off in settings. */
export type PushPermission = 'granted' | 'undetermined' | 'denied' | 'unsupported';

function toPermission(p: Notifications.NotificationPermissionsStatus): PushPermission {
  // iOS: the iOS field decides; provisional (and ephemeral) count as allowed (Edge cases).
  const ios = p.ios?.status;
  if (Platform.OS === 'ios' && ios !== undefined) {
    if (
      ios === IosAuthorizationStatus.AUTHORIZED ||
      ios === IosAuthorizationStatus.PROVISIONAL ||
      ios === IosAuthorizationStatus.EPHEMERAL
    ) {
      return 'granted';
    }
    return ios === IosAuthorizationStatus.NOT_DETERMINED ? 'undetermined' : 'denied';
  }
  if (p.granted || p.status === 'granted') return 'granted';
  if (p.status === 'undetermined' && p.canAskAgain !== false) return 'undetermined';
  return 'denied';
}

/** The current permission, without asking. Never throws. */
export async function pushPermission(): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch {
    return 'denied';
  }
}

/** AC 1: Android needs the channel before the prompt (Android 13+). Sound on, no badge. */
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'General',
    importance: AndroidImportance.HIGH,
    showBadge: false,
  });
}

/**
 * AC 1: asks once, only when Sham has never asked on this phone (the Notifications page calls it on its first open and
 * when a switch is turned on). Returns the permission after asking. Never throws.
 */
export async function askPushPermission(): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  try {
    const now = await pushPermission();
    if (now !== 'undetermined') return now;
    await ensureChannel();
    return toPermission(
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }),
    );
  } catch {
    return pushPermission();
  }
}

/** A random id for this install, kept on the phone; it says nothing about the person or the device. */
export async function installId(): Promise<string> {
  const saved = await AsyncStorage.getItem(INSTALL_ID_KEY);
  if (saved) return saved;
  const id = newId();
  await AsyncStorage.setItem(INSTALL_ID_KEY, id);
  return id;
}

/** The database calls this file makes (the store passes supabase.rpc in). */
export type PushRpc = (fn: 'register_push_device' | 'unregister_push_device', args: Record<string, string>) => PromiseLike<{
  error: unknown;
}>;

/**
 * AC 2 / AC 3: on app open, on returning to the foreground and from the Notifications page: allowed → (re)register
 * this phone for the signed-in account (a changed token replaces the old one, another account's row moves);
 * declined or turned off → remove this phone's registration. Waiting or declined accounts do nothing (AC 5). Every
 * failure (offline, no token yet) is silent and tried again next time.
 */
export async function syncPushRegistration(rpc: PushRpc, approved: boolean): Promise<void> {
  if (!pushSupported()) return;
  try {
    // AC 5: a waiting or declined account registers nothing (the server would refuse it anyway).
    if (!approved) return;
    const permission = await pushPermission();
    // Never asked on this phone: nothing was ever registered, so there's nothing to do (no prompt here, AC 1).
    if (permission === 'undetermined') return;
    const device = await installId();
    // AC 3: declined, or turned off in the phone's settings: remove this phone's registration (if any).
    if (permission !== 'granted') {
      await rpc('unregister_push_device', { device });
      return;
    }
    await ensureChannel();
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!token) return;
    await rpc('register_push_device', { device, token, platform: Platform.OS });
  } catch {
    // Tried again on the next open.
  }
}

/** AC 4: removes this phone's registration before signing out. Gives up after `timeoutMs` (offline). */
export async function unregisterThisPhone(rpc: PushRpc, timeoutMs = 5000): Promise<void> {
  if (!pushSupported()) return;
  const attempt = (async () => {
    const device = await installId();
    await rpc('unregister_push_device', { device });
  })().catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([attempt, timeout]);
  if (timer) clearTimeout(timer);
}

let handlerSet = false;
/** AC 12: a push that arrives while Sham is open still shows as a banner (and in the list), with sound, no badge. */
export function showPushesInForeground() {
  if (handlerSet || !pushSupported()) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
