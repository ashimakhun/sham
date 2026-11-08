// ARU-49: the homework-reviewed-notifications Edge Function's logic. Called by the trigger from migration 0037
// (through pg_net) once per homework that goes submitted -> checked, with {"homework_id": "<id>"} and
// "Authorization: Bearer <secret>". Asks homework_reviewed_recipient() who gets the message (the sender, if still
// Approved and able to see the course) and sends "Your homework for <course title> was reviewed" through the ARU-48
// helper, which skips unlinked users and those with Homework reviewed off. Nothing is retried by a later call.
// No Deno-only imports, so Jest can test it.

import { localizedMessage, type SendResult, type TelegramMessage } from './telegram.ts';
import { telegramText, telegramTexts } from './telegram-texts.ts';
import { timingSafeEqual } from './telegram-bot.ts';

/** One row of homework_reviewed_recipient(). */
export type HomeworkRecipient = { course_title: string; user_id: string };

export type HomeworkReviewedDeps = {
  /** Calls homework_reviewed_recipient(homework_id) with the service role. Throws on a database error. */
  recipient: (homeworkId: string) => Promise<HomeworkRecipient[]>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** What a call returns (and logs), so a call can be checked from net._http_response without Telegram. */
export type HomeworkReviewedReport = { recipients: number } & SendResult;

/** The message text, exactly as the product owner set it (plain text: the title is shown as typed). */
export function homeworkReviewedText(courseTitle: string) {
  return telegramText('en', 'homeworkReviewed', { course: courseTitle });
}

/** One message per recipient row (in practice zero or one: the sender). */
export function homeworkReviewedMessages(rows: HomeworkRecipient[]): TelegramMessage[] {
  return rows.map((r) => localizedMessage(r.user_id, 'homework_reviewed', telegramTexts('homeworkReviewed', { course: r.course_title })));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 unless Authorization is "Bearer <secret>" (AC 7), 400 for a missing or malformed homework_id,
 * otherwise look up the recipient and send. A failed message is logged and dropped (AC 6).
 */
export async function handleHomeworkReviewedRequest(
  request: Request,
  secret: string,
  deps: HomeworkReviewedDeps,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const given = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(given, `Bearer ${secret}`)) return new Response('Unauthorized', { status: 401 });

  let homeworkId: unknown;
  try {
    homeworkId = ((await request.json()) as { homework_id?: unknown } | null)?.homework_id;
  } catch {
    homeworkId = undefined;
  }
  if (typeof homeworkId !== 'string' || !UUID.test(homeworkId)) {
    deps.log?.('homework-reviewed: missing or malformed homework_id');
    return json({ error: 'homework_id must be a uuid' }, 400);
  }

  let rows: HomeworkRecipient[];
  try {
    rows = await deps.recipient(homeworkId);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log?.(`homework-reviewed: ${homeworkId}: recipient lookup failed: ${error}`);
    return json({ error }, 500);
  }

  const messages = homeworkReviewedMessages(rows);
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
    `homework-reviewed: ${homeworkId}: ${messages.length} recipient(s), sent ${result.sent}, skipped ${result.skipped}, ` +
      `removed ${result.removed}, failed ${result.failed.length}${failed ? ` (${failed})` : ''}`,
  );
  const report: HomeworkReviewedReport = { recipients: messages.length, ...result };
  return json(report);
}
