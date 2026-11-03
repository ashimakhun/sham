// The Sham Telegram bot's update handling (ARU-48). The telegram-webhook Edge Function is a thin wrapper around
// handleTelegramWebhook(); everything here is plain TypeScript so Jest can test it with fetch and the database mocked.
// The bot only links (/start <code>) and unlinks (/stop) private chats; everything else is ignored.

export const CONNECTED = (name: string) =>
  `Connected to Sham as ${name}. You'll get your notifications here. Send /stop to disconnect.`;
export const EXPIRED = 'This link has expired. Open Sham → Profile → Connect Telegram to get a new one.';
export const DISCONNECTED = "Disconnected. You won't get Sham notifications here.";

export type BotDeps = {
  /** link_telegram_chat(code, chat_id) as the service role: the account's name, or null for a bad/old/used code. */
  linkChat(code: string, chatId: number): Promise<string | null>;
  /** unlink_telegram_chat(chat_id) as the service role. */
  unlinkChat(chatId: number): Promise<void>;
  /** A plain-text message to a chat. */
  reply(chatId: number, text: string): Promise<void>;
  log?: (message: string) => void;
};

type Update = {
  message?: { text?: string; chat?: { id?: number; type?: string } };
};

const CODE = /^[A-Za-z0-9_-]{1,64}$/;
const START = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/;
const STOP = /^\/stop(?:@\w+)?\s*$/;

/** Handles one update. Only new messages in private chats count; edits, callbacks and groups are ignored. */
export async function handleTelegramUpdate(update: Update, deps: BotDeps): Promise<void> {
  const message = update?.message;
  const chatId = message?.chat?.id;
  if (!message || typeof chatId !== 'number' || message.chat?.type !== 'private') return;
  const text = (message.text ?? '').trim();

  const start = START.exec(text);
  if (start) {
    const code = start[1];
    const name = code && CODE.test(code) ? await deps.linkChat(code, chatId) : null;
    await deps.reply(chatId, name ? CONNECTED(name) : EXPIRED);
    return;
  }
  if (STOP.test(text)) {
    await deps.unlinkChat(chatId);
    await deps.reply(chatId, DISCONNECTED);
  }
  // Any other text: no reply.
}

/** Compares two secrets without stopping at the first difference. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The webhook: rejects requests without the secret Telegram sends in X-Telegram-Bot-Api-Secret-Token (set with
 * setWebhook), and once the secret is right always answers 200, even if handling fails, so Telegram doesn't redeliver.
 */
export async function handleTelegramWebhook(request: Request, secret: string, deps: BotDeps): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const given = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!secret || !timingSafeEqual(given, secret)) return new Response('Unauthorized', { status: 401 });
  try {
    await handleTelegramUpdate((await request.json()) as Update, deps);
  } catch (e) {
    deps.log?.(`telegram update failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return new Response('ok', { status: 200 });
}
