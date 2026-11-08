// ARU-50: the new-homework-notifications Edge Function's logic. Called through pg_net by the after-insert trigger on
// homework_assignments (migration 0038) with {"assignment_id": "<id>"} and "Authorization: Bearer <secret>". Asks
// new_homework_recipients() for the course's current Approved listeners and sends each one
// "New homework assigned to you in <course title>" through the ARU-48 helper. No Deno-only imports, so Jest can test it.

import { localizedMessage, type SendResult, type TelegramMessage } from './telegram.ts';
import { telegramText, telegramTexts } from './telegram-texts.ts';
import { timingSafeEqual } from './telegram-bot.ts';

/** One row of new_homework_recipients(). */
export type NewHomeworkRecipient = { course_title: string; user_id: string };

export type NewHomeworkDeps = {
  /** Calls new_homework_recipients(assignment) with the service role. Throws on a database error. */
  recipients: (assignmentId: string) => Promise<NewHomeworkRecipient[]>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** What a call returns (and logs), so a run can be checked from net._http_response without Telegram. */
export type NewHomeworkReport = { recipients: number } & SendResult;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The message text, exactly as the product owner set it (plain text: the title is shown as typed). */
export function newHomeworkText(courseTitle: string) {
  return telegramText('en', 'newHomework', { course: courseTitle });
}

/** One message per recipient (AC 1, AC 8). */
export function newHomeworkMessages(recipients: NewHomeworkRecipient[]): TelegramMessage[] {
  return recipients.map((r) => localizedMessage(r.user_id, 'new_homework', telegramTexts('newHomework', { course: r.course_title })));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 without "Authorization: Bearer <secret>", 400 without a valid assignment_id (nothing is read or
 * sent and nothing about recipients is logged in either case), otherwise one helper call with one message per
 * recipient. Failed messages are logged and dropped: nothing calls the function again for the same assignment.
 */
export async function handleNewHomeworkRequest(
  request: Request,
  secret: string,
  deps: NewHomeworkDeps,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const given = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(given, `Bearer ${secret}`)) return new Response('Unauthorized', { status: 401 });

  let assignmentId: unknown;
  try {
    assignmentId = ((await request.json()) as { assignment_id?: unknown } | null)?.assignment_id;
  } catch {
    assignmentId = undefined;
  }
  if (typeof assignmentId !== 'string' || !UUID.test(assignmentId)) {
    return json({ error: 'assignment_id must be a uuid' }, 400);
  }

  let recipients: NewHomeworkRecipient[];
  try {
    recipients = await deps.recipients(assignmentId);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log?.(`new-homework: recipients for ${assignmentId} failed: ${error}`);
    return json({ error }, 500);
  }

  const messages = newHomeworkMessages(recipients);
  const result: SendResult = messages.length
    ? await deps.send(messages)
    : { sent: 0, skipped: 0, failed: [], removed: 0 };
  const failed = result.failed.map((f) => `${f.userId}: ${f.error}`).join('; ');
  deps.log?.(
    `new-homework: assignment ${assignmentId}, ${recipients.length} recipient(s), sent ${result.sent}, ` +
      `skipped ${result.skipped}, removed ${result.removed}, failed ${result.failed.length}${failed ? ` (${failed})` : ''}`,
  );
  return json({ recipients: recipients.length, ...result } satisfies NewHomeworkReport);
}
