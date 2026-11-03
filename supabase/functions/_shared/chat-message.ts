// ARU-44 / ARU-87: the chat-message-notifications Edge Function's logic. Called through pg_net by two after-insert
// triggers, with `Authorization: Bearer <CHAT_NOTIFY_SECRET>`:
//   * course_messages (0036) with {"message_id": "<id>"}: asks chat_message_recipients() who gets it (computed now:
//     everyone in the chat but the author, every message since ARU-87 / 0046) and sends "New message in the <course
//     title> chat" with kind chat_message (the Chat messages switch);
//   * general_messages (ARU-87, 0046) with {"general_message_id": "<id>"}: asks general_message_recipients() (every
//     Approved user but the author) and sends "New message in the general chat" with kind general_chat (the General
//     chat switch).
// The ARU-48 helper skips people who aren't linked or have that switch off. No Deno-only imports, so Jest can test it.

import type { SendResult, TelegramMessage } from './telegram.ts';
import { timingSafeEqual } from './telegram-bot.ts';

/** What chat_message_recipients() returns for a known message; null for an unknown (or deleted) one. */
export type ChatMessageRecipients = { course_title: string; recipient_ids: string[] | null };

/** What general_message_recipients() returns for a known message; null for an unknown (or deleted) one. */
export type GeneralMessageRecipients = { recipient_ids: string[] | null };

export type ChatMessageDeps = {
  /** Calls chat_message_recipients(message) with the service role. Throws on a database error. */
  recipients: (messageId: string) => Promise<ChatMessageRecipients | null>;
  /** Calls general_message_recipients(message) with the service role (ARU-87). Throws on a database error. */
  generalRecipients?: (messageId: string) => Promise<GeneralMessageRecipients | null>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** What a call returns (and logs), so a run can be checked from net._http_response without Telegram. */
export type ChatMessageReport = { message_id: string; recipients: number } & SendResult;
/** The same for a general chat message (ARU-87). */
export type GeneralMessageReport = { general_message_id: string; recipients: number } & SendResult;

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

/** The general chat text (ARU-87): no message body, no author. */
export const GENERAL_CHAT_TEXT = 'New message in the general chat';

/** One general_chat message per recipient (ARU-87 AC 4). */
export function generalMessageMessages(found: GeneralMessageRecipients | null): TelegramMessage[] {
  if (!found) return [];
  return (found.recipient_ids ?? []).map((userId) => ({ userId, kind: 'general_chat' as const, text: GENERAL_CHAT_TEXT }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 without `Authorization: Bearer <secret>` (AC 8), 405 for anything but POST, 400 unless the body has
 * exactly one of a valid message_id (course chat) or general_message_id (general chat, ARU-87); otherwise look up the
 * recipients and send once. A failed message is logged and dropped, never retried.
 */
export async function handleChatMessageRequest(
  request: Request,
  secret: string,
  deps: ChatMessageDeps,
): Promise<Response> {
  const given = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(given, `Bearer ${secret}`)) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: { message_id?: unknown; general_message_id?: unknown } | null = null;
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as typeof body;
  } catch {
    body = null;
  }
  const hasCourse = body?.message_id !== undefined;
  const hasGeneral = body?.general_message_id !== undefined;
  if (hasCourse && hasGeneral) return json({ error: 'send message_id or general_message_id, not both' }, 400);
  if (hasGeneral) return handleGeneral(body?.general_message_id, deps);

  const messageId = body?.message_id;
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

/** ARU-87: a general chat message. */
async function handleGeneral(messageId: unknown, deps: ChatMessageDeps): Promise<Response> {
  if (typeof messageId !== 'string' || !UUID.test(messageId)) {
    return json({ error: 'general_message_id must be a uuid' }, 400);
  }
  if (!deps.generalRecipients) return json({ error: 'general chat is not wired' }, 500);

  let found: GeneralMessageRecipients | null;
  try {
    found = await deps.generalRecipients(messageId);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log?.(`general-message: recipients for ${messageId} failed: ${error}`);
    return json({ error }, 500);
  }

  const messages = generalMessageMessages(found);
  const result: SendResult = messages.length
    ? await deps.send(messages)
    : { sent: 0, skipped: 0, failed: [], removed: 0 };
  const report: GeneralMessageReport = { general_message_id: messageId, recipients: messages.length, ...result };
  const failed = result.failed.map((f) => `${f.userId}: ${f.error}`).join('; ');
  deps.log?.(
    `general-message: ${messageId}${found ? '' : ' (not found)'}: ${messages.length} recipient(s), sent ${result.sent}, ` +
      `skipped ${result.skipped}, removed ${result.removed}, failed ${result.failed.length}${failed ? ` (${failed})` : ''}`,
  );
  return json(report);
}
