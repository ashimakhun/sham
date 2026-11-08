// ARU-89: the homework-submitted-notifications Edge Function's logic. Called by the trigger from migration 0045
// (through pg_net) once per inserted homework, with {"homework_id": "<id>"} and "Authorization: Bearer <secret>".
// Asks homework_submitted_recipient() who gets the message (the course's current owner, if Approved and still a
// teacher or mentor) and sends "New homework to check from <sender name> in <course title>: <assignment title>"
// through the ARU-48 helper, which skips an unlinked owner or one with Homework submitted off. Nothing is retried.
// No Deno-only imports, so Jest can test it.

import { localizedMessage, type SendResult, type TelegramMessage } from './telegram.ts';
import { telegramText, telegramTexts } from './telegram-texts.ts';
import { timingSafeEqual } from './telegram-bot.ts';

/** One row of homework_submitted_recipient(). */
export type HomeworkSubmittedRecipient = {
  course_title: string;
  assignment_title: string;
  sender_name: string;
  user_id: string;
};

export type HomeworkSubmittedDeps = {
  /** Calls homework_submitted_recipient(homework_id) with the service role. Throws on a database error. */
  recipient: (homeworkId: string) => Promise<HomeworkSubmittedRecipient[]>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** What a call returns (and logs), so a call can be checked from net._http_response without Telegram. */
export type HomeworkSubmittedReport = { recipients: number } & SendResult;

/** The message text, exactly as the story sets it (plain text: names and titles are shown as typed). */
export function homeworkSubmittedText(senderName: string, courseTitle: string, assignmentTitle: string) {
  return telegramText('en', 'homeworkSubmitted', { name: senderName, course: courseTitle, assignment: assignmentTitle });
}

/** One message per recipient row (in practice zero or one: the owner). */
export function homeworkSubmittedMessages(rows: HomeworkSubmittedRecipient[]): TelegramMessage[] {
  return rows.map((r) =>
    localizedMessage(
      r.user_id,
      'homework_submitted',
      telegramTexts('homeworkSubmitted', { name: r.sender_name, course: r.course_title, assignment: r.assignment_title }),
    ),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 unless Authorization is "Bearer <secret>" (AC 8), 400 for a missing or malformed homework_id,
 * otherwise look up the recipient and send. A failed message is logged and dropped (AC 7).
 */
export async function handleHomeworkSubmittedRequest(
  request: Request,
  secret: string,
  deps: HomeworkSubmittedDeps,
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
    deps.log?.('homework-submitted: missing or malformed homework_id');
    return json({ error: 'homework_id must be a uuid' }, 400);
  }

  let rows: HomeworkSubmittedRecipient[];
  try {
    rows = await deps.recipient(homeworkId);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log?.(`homework-submitted: ${homeworkId}: recipient lookup failed: ${error}`);
    return json({ error }, 500);
  }

  const messages = homeworkSubmittedMessages(rows);
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
    `homework-submitted: ${homeworkId}: ${messages.length} recipient(s), sent ${result.sent}, skipped ${result.skipped}, ` +
      `removed ${result.removed}, failed ${result.failed.length}${failed ? ` (${failed})` : ''}`,
  );
  const report: HomeworkSubmittedReport = { recipients: messages.length, ...result };
  return json(report);
}
