// ARU-151: the meeting-notes-notifications Edge Function's logic. Called by the trigger from migration 0062 (through
// pg_net) once per note, when it is first published, with {"id": "<note id>"} and "Authorization: Bearer <secret>".
// Asks meeting_notes_recipients() who gets the message (the note's Approved readers except its author: the course's
// current listeners, its owner and the teacher, who have a Telegram link with Meeting notes on) and sends "New notes
// from <author name> on a <course title> meeting" in each recipient's language through the ARU-48 helper in one call,
// with kind meeting_notes. Nothing is retried. No Deno-only imports, so Jest can test it.

import { localizedMessage, type SendResult, type TelegramMessage } from './telegram.ts';
import { telegramText, telegramTexts } from './telegram-texts.ts';
import { timingSafeEqual } from './telegram-bot.ts';

/** One row of meeting_notes_recipients(). */
export type MeetingNotesRecipient = { user_id: string; author_name: string; course_title: string };

export type MeetingNotesDeps = {
  /** Calls meeting_notes_recipients(note) with the service role. Throws on a database error. */
  recipients: (id: string) => Promise<MeetingNotesRecipient[]>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** What a call returns (and logs), so a call can be checked from net._http_response without Telegram. */
export type MeetingNotesReport = { recipients: number } & SendResult;

/** The English text, exactly as the story sets it (plain text: names and titles as typed; never the notes). */
export function meetingNotesText(authorName: string, courseTitle: string) {
  return telegramText('en', 'meetingNotesPublished', { name: authorName, course: courseTitle });
}

/** One message per recipient row, in every language (each recipient gets theirs, ARU-110). */
export function meetingNotesMessages(rows: MeetingNotesRecipient[]): TelegramMessage[] {
  return rows.map((r) =>
    localizedMessage(
      r.user_id,
      'meeting_notes',
      telegramTexts('meetingNotesPublished', { name: r.author_name, course: r.course_title }),
    ),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 unless Authorization is "Bearer <secret>" (AC 10), 400 for a missing or malformed id, otherwise
 * look up the recipients and send them all in one call. A failed message is logged and dropped (AC 9).
 */
export async function handleMeetingNotesRequest(
  request: Request,
  secret: string,
  deps: MeetingNotesDeps,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const given = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(given, `Bearer ${secret}`)) return new Response('Unauthorized', { status: 401 });

  let body: { id?: unknown } | null = null;
  try {
    body = (await request.json()) as { id?: unknown } | null;
  } catch {
    body = null;
  }
  const id = body?.id;
  if (typeof id !== 'string' || !UUID.test(id)) {
    deps.log?.('meeting-notes: missing or malformed id');
    return json({ error: 'id must be a uuid' }, 400);
  }

  let rows: MeetingNotesRecipient[];
  try {
    rows = await deps.recipients(id);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log?.(`meeting-notes: ${id}: recipient lookup failed: ${error}`);
    return json({ error }, 500);
  }

  const messages = meetingNotesMessages(rows);
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
    `meeting-notes: ${id}: ${messages.length} recipient(s), sent ${result.sent}, skipped ${result.skipped}, ` +
      `removed ${result.removed}, failed ${result.failed.length}${failed ? ` (${failed})` : ''}`,
  );
  const report: MeetingNotesReport = { recipients: messages.length, ...result };
  return json(report);
}
