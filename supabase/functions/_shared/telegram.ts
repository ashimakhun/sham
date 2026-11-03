// Shared Telegram sending helper (ARU-48). Used by every Edge Function that sends a Sham notification (ARU-41 meeting
// started, ARU-44 chat message, ARU-49 homework reviewed, ARU-50 new homework, ARU-84 new account,
// ARU-89 homework submitted, ARU-87 general chat). No Deno-only imports: the service-role
// client, the bot token and fetch are passed in, so Jest can test it (supabase/functions/_shared/*.test.ts).

export type NotificationKind = 'meeting_started' | 'chat_message' | 'homework_reviewed' | 'new_homework' | 'new_account'
  | 'homework_submitted'
  | 'general_chat';

export type TelegramMessage = { userId: string; kind: NotificationKind; text: string };

export type SendResult = {
  /** Messages Telegram accepted. */
  sent: number;
  /** Messages not sent because the user isn't linked or has that kind turned off. */
  skipped: number;
  /** Messages that still failed after the retries of this call (never retried by a later call). */
  failed: { userId: string; error: string }[];
  /** Links deleted because Telegram answered 403 (bot blocked, user deactivated). */
  removed: number;
};

/** Which telegram_links column turns each kind on or off. */
export const SWITCH_COLUMN: Record<NotificationKind, string> = {
  meeting_started: 'notify_meeting_started',
  new_homework: 'notify_new_homework',
  homework_reviewed: 'notify_homework_reviewed',
  chat_message: 'notify_chat_message',
  new_account: 'notify_new_account',
  homework_submitted: 'notify_homework_submitted',
  general_chat: 'notify_general_chat',
};

type LinkRow = { user_id: string; chat_id: number | string } & Record<string, unknown>;
type DbResult = { data: unknown; error: { message: string } | null };

/** The bits of a supabase-js client (service role) this helper uses. */
export type ServiceClient = {
  from(table: 'telegram_links'): {
    select(columns: string): { in(column: string, values: string[]): PromiseLike<DbResult> };
    delete(): { eq(column: string, value: unknown): { eq(column: string, value: unknown): PromiseLike<DbResult> } };
  };
};

export type SendOptions = {
  /** At most this many sends start in any 1-second window (Telegram allows about 30 per second per bot). */
  perSecond?: number;
  /** Tries per message within this call, counting 429s, 5xx and network errors. */
  maxTries?: number;
  /** The call gives up waiting after this long; a 429 asking to wait past it is recorded as failed. */
  budgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Attempt =
  | { kind: 'ok' }
  | { kind: 'blocked'; error: string }
  | { kind: 'wait'; ms: number; error: string }
  | { kind: 'retry'; error: string }
  | { kind: 'fail'; error: string };

/** One sendMessage call, classified. Plain text: no parse_mode, so course names are never read as Markdown/HTML. */
async function sendOnce(fetchFn: typeof fetch, token: string, chatId: number | string, text: string): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (e) {
    return { kind: 'retry', error: e instanceof Error ? e.message : String(e) };
  }
  if (res.ok) return { kind: 'ok' };
  let body: { description?: string; parameters?: { retry_after?: number } } = {};
  try {
    body = await res.json();
  } catch {
    // Not JSON: keep the status only.
  }
  const error = `${res.status} ${body.description ?? res.statusText ?? ''}`.trim();
  if (res.status === 403) return { kind: 'blocked', error };
  if (res.status === 429) return { kind: 'wait', ms: Math.max(0, body.parameters?.retry_after ?? 1) * 1000, error };
  if (res.status >= 500) return { kind: 'retry', error };
  return { kind: 'fail', error };
}

/**
 * Sends each message to its user's linked Telegram chat, if that user has the message's kind turned on.
 * Rate-limited, retried within this call only, and a 403 removes the link. Never throws for a single message.
 */
export async function sendTelegramMessages(
  client: ServiceClient,
  token: string,
  fetchFn: typeof fetch,
  messages: TelegramMessage[],
  options: SendOptions = {},
): Promise<SendResult> {
  const { perSecond = 25, maxTries = 3, budgetMs = 50_000, now = Date.now, sleep = defaultSleep } = options;
  const result: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };
  if (!messages.length) return result;
  const deadline = now() + budgetMs;

  const userIds = [...new Set(messages.map((m) => m.userId))];
  const { data, error } = await client.from('telegram_links').select('*').in('user_id', userIds);
  if (error) {
    for (const m of messages) result.failed.push({ userId: m.userId, error: error.message });
    return result;
  }
  const links = new Map(((data as LinkRow[] | null) ?? []).map((l) => [l.user_id, l]));

  // Start times of recent sends, for the per-second limit.
  const starts: number[] = [];
  async function throttle() {
    for (;;) {
      const t = now();
      while (starts.length && starts[0] <= t - 1000) starts.shift();
      if (starts.length < perSecond) {
        starts.push(t);
        return;
      }
      await sleep(starts[0] + 1000 - t);
    }
  }

  for (const m of messages) {
    const link = links.get(m.userId);
    if (!link || link[SWITCH_COLUMN[m.kind]] !== true) {
      result.skipped++;
      continue;
    }
    let lastError = 'not sent';
    let done = false;
    for (let attempt = 1; attempt <= maxTries && !done; attempt++) {
      await throttle();
      const outcome = await sendOnce(fetchFn, token, link.chat_id, m.text);
      if (outcome.kind === 'ok') {
        result.sent++;
        done = true;
        break;
      }
      lastError = outcome.error;
      if (outcome.kind === 'blocked') {
        await client.from('telegram_links').delete().eq('user_id', m.userId).eq('chat_id', link.chat_id);
        links.delete(m.userId); // later messages to this user are skipped
        result.removed++;
        result.failed.push({ userId: m.userId, error: lastError });
        done = true;
        break;
      }
      if (outcome.kind === 'fail' || attempt === maxTries) break;
      const wait = outcome.kind === 'wait' ? outcome.ms : 500 * attempt;
      if (now() + wait > deadline) break; // no time left in this call: give up now, never later
      await sleep(wait);
    }
    if (!done) result.failed.push({ userId: m.userId, error: lastError });
  }
  return result;
}

/** A plain-text reply from the bot (used by the webhook for /start and /stop). */
export async function sendTelegramText(fetchFn: typeof fetch, token: string, chatId: number | string, text: string) {
  const outcome = await sendOnce(fetchFn, token, chatId, text);
  if (outcome.kind !== 'ok') throw new Error(`Telegram sendMessage failed: ${outcome.error}`);
}
