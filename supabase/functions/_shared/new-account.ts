// ARU-84: the new-account-notifications Edge Function's logic. Called by the trigger from migration 0044 (through
// pg_net) once per new pending profile (an Auth sign-up), with {"user_id": "<id>"} and "Authorization: Bearer <secret>".
// Asks new_account_notification() whether the account is still waiting and who the teacher is, and sends
// "New account waiting for your approval: <name>. Open Sham → Manage roles to accept or decline." through the ARU-48
// helper, which skips an unlinked teacher or one with New accounts off. Nothing is retried by a later call.
// No Deno-only imports, so Jest can test it.

import type { SendResult, TelegramMessage } from './telegram.ts';
import { timingSafeEqual } from './telegram-bot.ts';

/** One row of new_account_notification(): the waiting account's name and the teacher's id. */
export type NewAccountRecipient = { account_name: string; user_id: string };

export type NewAccountDeps = {
  /** Calls new_account_notification(user_id) with the service role. Throws on a database error. */
  recipient: (userId: string) => Promise<NewAccountRecipient[]>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** What a call returns (and logs), so a call can be checked from net._http_response without Telegram. */
export type NewAccountReport = { recipients: number } & SendResult;

/** The message text, exactly as the story sets it (plain text: the name is shown as typed). */
export function newAccountText(name: string) {
  return `New account waiting for your approval: ${name}. Open Sham → Manage roles to accept or decline.`;
}

/** One message per recipient row (in practice zero or one: the teacher). */
export function newAccountMessages(rows: NewAccountRecipient[]): TelegramMessage[] {
  return rows.map((r) => ({ userId: r.user_id, kind: 'new_account' as const, text: newAccountText(r.account_name) }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 unless Authorization is "Bearer <secret>" (AC 7), 400 for a missing or malformed user_id,
 * otherwise look up the recipient and send. A failed message is logged and dropped (AC 6).
 */
export async function handleNewAccountRequest(request: Request, secret: string, deps: NewAccountDeps): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const given = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(given, `Bearer ${secret}`)) return new Response('Unauthorized', { status: 401 });

  let userId: unknown;
  try {
    userId = ((await request.json()) as { user_id?: unknown } | null)?.user_id;
  } catch {
    userId = undefined;
  }
  if (typeof userId !== 'string' || !UUID.test(userId)) {
    deps.log?.('new-account: missing or malformed user_id');
    return json({ error: 'user_id must be a uuid' }, 400);
  }

  let rows: NewAccountRecipient[];
  try {
    rows = await deps.recipient(userId);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log?.(`new-account: ${userId}: recipient lookup failed: ${error}`);
    return json({ error }, 500);
  }

  const messages = newAccountMessages(rows);
  let result: SendResult = empty;
  if (messages.length) {
    try {
      result = await deps.send(messages);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result = { ...empty, failed: messages.map((m) => ({ userId: m.userId, error })) };
    }
  }
  const failed = result.failed.map((f) => `${f.userId}: ${f.error}`).join('; ');
  deps.log?.(
    `new-account: ${userId}: ${messages.length} recipient(s), sent ${result.sent}, skipped ${result.skipped}, ` +
      `removed ${result.removed}, failed ${result.failed.length}${failed ? ` (${failed})` : ''}`,
  );
  const report: NewAccountReport = { recipients: messages.length, ...result };
  return json(report);
}
