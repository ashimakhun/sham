// ARU-166: the shared push sender. Every notification Edge Function sends through it: each message goes to every
// phone its recipient registered (push_devices), if that recipient has the message's kind switched on in notification_settings (no row = every switch on), through
// Expo's push service (in front of Apple's APNs and Google's FCM). Messages are the same as before (NotificationMessage,
// with every language), and the result keeps the same shape: sent, skipped, failed and removed.
//
// * The text is in the recipient's language (profiles.language, then device_language, then English; ARU-110).
// * The title is "Sham". Texts name no person (ARU-166 AC 10): that's the catalog's job (notification-texts.ts).
// * At most 100 notifications per request (Expo's limit). Network errors, 429 and 5xx are retried within this call
//   (at most 3 tries in all) and never by a later call. Any other error fails that request's notifications.
// * Only push tickets are read: a ticket with DeviceNotRegistered deletes that registration (counted in `removed`).
//   Receipts are never fetched (ARU-166 Out of scope).
// * EXPO_ACCESS_TOKEN is optional: sent as a bearer token when set (only needed if push security is on in Expo).
//
// No Deno-only imports: the service-role client and fetch are passed in, so Jest can test it.

import { type NotificationKind, type SendResult, SWITCH_COLUMN, type NotificationMessage } from './notification.ts';
import { recipientLanguage, type NotificationLanguage } from './notification-texts.ts';

export type { SendResult };
export type PushMessage = NotificationMessage;

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const PUSH_TITLE = 'Sham';
/** The Android channel the app creates before asking for permission (AC 1). */
export const ANDROID_CHANNEL_ID = 'default';
const BATCH = 100;

type DbResult = { data: unknown; error: { message: string } | null };

/** The bits of a supabase-js client (service role) this sender uses. */
export type PushServiceClient = {
  from(table: 'notification_settings' | 'push_devices' | 'profiles'): {
    select(columns: string): { in(column: string, values: string[]): PromiseLike<DbResult> };
    delete(): { in(column: string, values: string[]): PromiseLike<DbResult> };
  };
};

export type PushOptions = {
  /** EXPO_ACCESS_TOKEN, when push security is turned on in Expo. */
  accessToken?: string;
  /** Tries per request within this call, counting 429s, 5xx and network errors. */
  maxTries?: number;
  /** The call gives up waiting after this long. */
  budgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type DeviceRow = { user_id: string; token: string };
type SettingsRow = { user_id: string } & Record<string, unknown>;
type ProfileLanguageRow = { id: string; language?: unknown; device_language?: unknown };
type Ticket = { status?: string; message?: string; details?: { error?: string } };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Is this kind on for a user? No settings row, or a column the row doesn't have yet, means on (AC 8). */
export function kindIsOn(row: SettingsRow | undefined, kind: NotificationKind) {
  return row?.[SWITCH_COLUMN[kind]] !== false;
}

async function languagesOf(client: PushServiceClient, messages: PushMessage[]) {
  const languages = new Map<string, NotificationLanguage>();
  const ids = [...new Set(messages.filter((m) => m.texts?.ru).map((m) => m.userId))];
  if (!ids.length) return languages;
  try {
    const { data, error } = await client.from('profiles').select('id, language, device_language').in('id', ids);
    if (error) return languages;
    for (const row of (data as ProfileLanguageRow[] | null) ?? []) {
      if (typeof row?.id === 'string') languages.set(row.id, recipientLanguage(row));
    }
  } catch {
    // English for everyone: a language problem never stops a notification.
  }
  return languages;
}

type Outgoing = { message: number; userId: string; token: string; body: string };
type BatchOutcome = { ok: true; tickets: Ticket[] } | { ok: false; error: string };

/** One request with up to 100 notifications, retried within this call on network errors, 429 and 5xx. */
async function sendBatch(
  fetchFn: typeof fetch,
  batch: Outgoing[],
  options: Required<Pick<PushOptions, 'maxTries' | 'now' | 'sleep'>> & { accessToken?: string; deadline: number },
): Promise<BatchOutcome> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate',
    'content-type': 'application/json',
  };
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;
  const payload = JSON.stringify(
    batch.map((o) => ({
      to: o.token,
      title: PUSH_TITLE,
      body: o.body,
      sound: 'default',
      priority: 'high',
      channelId: ANDROID_CHANNEL_ID,
    })),
  );
  let lastError = 'not sent';
  for (let attempt = 1; attempt <= options.maxTries; attempt++) {
    let retry = false;
    let waitMs = 500 * attempt;
    try {
      const res = await fetchFn(EXPO_PUSH_URL, { method: 'POST', headers, body: payload });
      let json: { data?: unknown; errors?: { message?: string }[] } | null = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (res.ok && Array.isArray(json?.data)) return { ok: true, tickets: json.data as Ticket[] };
      const detail = json?.errors?.map((e) => e.message).filter(Boolean).join('; ');
      lastError = `${res.status} ${detail || res.statusText || ''}`.trim();
      if (res.status === 429 || res.status >= 500) {
        retry = true;
        const after = Number(res.headers?.get?.('retry-after'));
        if (res.status === 429 && Number.isFinite(after) && after > 0) waitMs = after * 1000;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      retry = true;
    }
    if (!retry || attempt === options.maxTries) break;
    if (options.now() + waitMs > options.deadline) break; // no time left in this call: give up now, never later
    await options.sleep(waitMs);
  }
  return { ok: false, error: lastError };
}

/**
 * Sends each message as a push to every phone of its user, if the user has the message's kind on. Never throws for a
 * single message: a message is `sent` when at least one phone accepted it, `skipped` when its kind is off or the user
 * has no phone, and otherwise `failed` (with the last error).
 */
export async function sendPushMessages(
  client: PushServiceClient,
  fetchFn: typeof fetch,
  messages: PushMessage[],
  options: PushOptions = {},
): Promise<SendResult> {
  const { maxTries = 3, budgetMs = 50_000, now = Date.now, sleep = defaultSleep, accessToken } = options;
  const result: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };
  if (!messages.length) return result;
  const deadline = now() + budgetMs;
  const failAll = (error: string) => {
    for (const m of messages) result.failed.push({ userId: m.userId, error });
    return result;
  };

  const userIds = [...new Set(messages.map((m) => m.userId))];
  const settingsRes = await client.from('notification_settings').select('*').in('user_id', userIds);
  if (settingsRes.error) return failAll(settingsRes.error.message);
  const settings = new Map(((settingsRes.data as SettingsRow[] | null) ?? []).map((r) => [r.user_id, r]));
  const devicesRes = await client.from('push_devices').select('user_id, token').in('user_id', userIds);
  if (devicesRes.error) return failAll(devicesRes.error.message);
  const devices = new Map<string, string[]>();
  for (const d of (devicesRes.data as DeviceRow[] | null) ?? []) {
    if (typeof d?.token !== 'string') continue;
    devices.set(d.user_id, [...(devices.get(d.user_id) ?? []), d.token]);
  }
  const languages = await languagesOf(client, messages);

  const outgoing: Outgoing[] = [];
  const pending = new Set<number>();
  messages.forEach((m, i) => {
    const tokens = devices.get(m.userId) ?? [];
    if (!kindIsOn(settings.get(m.userId), m.kind) || !tokens.length) {
      result.skipped++;
      return;
    }
    const body = m.texts?.[languages.get(m.userId) ?? 'en'] || m.text;
    pending.add(i);
    for (const token of tokens) outgoing.push({ message: i, userId: m.userId, token, body });
  });

  const delivered = new Set<number>();
  const lastError = new Map<number, string>();
  const gone = new Set<string>();
  for (let start = 0; start < outgoing.length; start += BATCH) {
    const batch = outgoing.slice(start, start + BATCH);
    const outcome = await sendBatch(fetchFn, batch, { maxTries, now, sleep, accessToken, deadline });
    batch.forEach((o, j) => {
      if (!outcome.ok) {
        lastError.set(o.message, outcome.error);
        return;
      }
      const ticket = outcome.tickets[j];
      if (ticket?.status === 'ok') {
        delivered.add(o.message);
        return;
      }
      const code = ticket?.details?.error;
      if (code === 'DeviceNotRegistered') gone.add(o.token);
      lastError.set(o.message, [code, ticket?.message].filter(Boolean).join(': ') || 'no ticket');
    });
  }

  if (gone.size) {
    try {
      const del = await client.from('push_devices').delete().in('token', [...gone]);
      if (!del.error) result.removed = gone.size;
    } catch {
      // Removed on a later send that reports it again.
    }
  }
  for (const i of pending) {
    if (delivered.has(i)) result.sent++;
    else result.failed.push({ userId: messages[i].userId, error: lastError.get(i) ?? 'not sent' });
  }
  return result;
}
