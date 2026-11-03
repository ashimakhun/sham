// ARU-44: the chat-message-notifications Edge Function's logic. Called through pg_net by the after-insert trigger on
// course_messages (migration 0036) with {"message_id": "<id>"} and `Authorization: Bearer <CHAT_NOTIFY_SECRET>`. Asks
// chat_message_recipients() who gets this message (computed now: the "oldest new message" rule) and sends
// "New message in the <course title> chat" to each of them through the ARU-48 helper, which skips people who aren't
// linked or have Chat messages off. No Deno-only imports, so Jest can test it.

import type { SendResult, TelegramMessage } from './telegram.ts';
import { timingSafeEqual } from './telegram-bot.ts';

/** What chat_message_recipients() returns for a known message; null for an unknown (or deleted) one. */
export type ChatMessageRecipients = { course_title: string; recipient_ids: string[] | null };

export type ChatMessageDeps = {
  /** Calls chat_message_recipients(message) with the service role. Throws on a database error. */
  recipients: (messageId: string) => Promise<ChatMessageRecipients | null>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** What a call returns (and logs), so a run can be checked from net._http_response without Telegram. */
export type ChatMessageReport = { message_id: string; recipients: number } & SendResult;

/** The message text, exactly as the product owner set it (plain text: the title is shown as typed). */
export function chatMessageText(courseTitle: string) {
  return `New message in the ${courseTitle} chat`;
}

/** One chat_message message per recipient (AC 1). Never includes the chat text or its author. */
export function chatMessageMessages(found: ChatMessageRecipients | null): TelegramMessage[] {
  if (!found) return [];
  const text = chatMessageText(found.course_title);
  return (found.recipient_ids ?? []).map((userId) => ({ userId, kind: 'chat_message' as const, text }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 without `Authorization: Bearer <secret>` (AC 8), 405 for anything but POST, 400 without a valid
 * message_id; otherwise look up the recipients and send once. A failed message is logged and dropped, never retried.
 */
export async function handleChatMessageRequest(
  request: Request,
  secret: string,
  deps: ChatMessageDeps,
): Promise<Response> {
  const given = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(given, `Bearer ${secret}`)) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let messageId: unknown;
  try {
    messageId = ((await request.json()) as { message_id?: unknown } | null)?.message_id;
  } catch {
    messageId = undefined;
  }
  if (typeof messageId !== 'string' || !UUID.test(messageId)) return json({ error: 'message_id must be a uuid' }, 400);

  let found: ChatMessageRecipients | null;
  try {
    found = await deps.recipients(messageId);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log?.(`chat-message: recipients for ${messageId} failed: ${error}`);
    return json({ error }, 500);
  }

  const messages = chatMessageMessages(found);
  const result: SendResult = messages.length
    ? await deps.send(messages)
    : { sent: 0, skipped: 0, failed: [], removed: 0 };
  const report: ChatMessageReport = { message_id: messageId, recipients: messages.length, ...result };
  const failed = result.failed.map((f) => `${f.userId}: ${f.error}`).join('; ');
  deps.log?.(
    `chat-message: ${messageId}${found ? '' : ' (not found)'}: ${messages.length} recipient(s), sent ${result.sent}, ` +
      `skipped ${result.skipped}, removed ${result.removed}, failed ${result.failed.length}${failed ? ` (${failed})` : ''}`,
  );
  return json(report);
}
