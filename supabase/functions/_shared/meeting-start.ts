// ARU-41: the meeting-start-notifications Edge Function's logic. Called every minute by a pg_cron job (migration
// 0035) with the secret in the x-cron-secret header. Claims the meetings that just started (claim_started_meetings(),
// which marks them first, so a meeting is announced at most once) and only then sends "<course title> meeting has
// started" to each Approved listener through the ARU-48 helper. No Deno-only imports, so Jest can test it.

import { localizedMessage, type SendResult, type TelegramMessage } from './telegram.ts';
import { telegramText, telegramTexts } from './telegram-texts.ts';
import { timingSafeEqual } from './telegram-bot.ts';

/** One meeting claimed by claim_started_meetings(). */
export type ClaimedMeeting = { meeting_id: string; course_title: string; listener_ids: string[] | null };

export type MeetingStartDeps = {
  /** Calls claim_started_meetings() with the service role. Throws on a database error. */
  claim: () => Promise<ClaimedMeeting[]>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** The counts a run returns (and logs), so a run can be checked from net._http_response without Telegram. */
export type MeetingStartReport = { meetings: number } & SendResult;

/** The message text, exactly as the product owner set it (plain text: the title is shown as typed). */
export function meetingStartedText(courseTitle: string) {
  return telegramText('en', 'meetingStarted', { course: courseTitle });
}

/** One message per listener per claimed meeting (AC 1, AC 8). */
export function meetingStartMessages(meetings: ClaimedMeeting[]): TelegramMessage[] {
  return meetings.flatMap((m) =>
    // ARU-110: each listener gets it in their own language.
    (m.listener_ids ?? []).map((userId) =>
      localizedMessage(userId, 'meeting_started', telegramTexts('meetingStarted', { course: m.course_title })),
    ),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 without the right secret (AC 9), otherwise claim, then send (AC 3). A failed message is
 * reported and logged but never retried by a later run: its meeting is already claimed.
 */
export async function handleMeetingStartRequest(
  request: Request,
  secret: string,
  deps: MeetingStartDeps,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const given = request.headers.get('x-cron-secret') ?? '';
  if (!secret || !timingSafeEqual(given, secret)) return new Response('Unauthorized', { status: 401 });

  let meetings: ClaimedMeeting[];
  try {
    meetings = await deps.claim();
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log?.(`meeting-start: claim failed: ${error}`);
    return json({ error }, 500);
  }

  const messages = meetingStartMessages(meetings);
  const result: SendResult = messages.length
    ? await deps.send(messages)
    : { sent: 0, skipped: 0, failed: [], removed: 0 };
  const report: MeetingStartReport = { meetings: meetings.length, ...result };
  if (meetings.length) {
    const failed = result.failed.map((f) => `${f.userId}: ${f.error}`).join('; ');
    deps.log?.(
      `meeting-start: ${meetings.length} meeting(s), sent ${result.sent}, skipped ${result.skipped}, ` +
        `removed ${result.removed}, failed ${result.failed.length}${failed ? ` (${failed})` : ''}`,
    );
  }
  return json(report);
}
