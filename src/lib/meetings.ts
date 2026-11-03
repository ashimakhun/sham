import { colors } from './theme';
import type { Meeting } from './types';

/** Upcoming (Scheduled, start still in the future) soonest first, then everything else newest first (ARU-10 AC 2).
 *  Uses the device clock; the database's clock decides what may be saved. */
export function sortMeetings(meetings: Meeting[], now: number = Date.now()) {
  const time = (m: Meeting) => new Date(m.startsAt).getTime();
  const upcoming = meetings.filter((m) => m.status === 'scheduled' && time(m) > now).sort((a, b) => time(a) - time(b));
  const past = meetings.filter((m) => !upcoming.includes(m)).sort((a, b) => time(b) - time(a));
  return { upcoming, past };
}

/** ARU-60: the course page's meeting groups (device clock, like sortMeetings).
 *  - inProgress: Scheduled and started, oldest start first
 *  - upcoming: Scheduled, start in the future, soonest first
 *  - awaitingCheck: Completed and homework not marked checked, newest first
 *  - history: Completed and checked, or Canceled, newest first (shown at the bottom of the page) */
export function groupMeetings(meetings: Meeting[], now: number = Date.now()) {
  const time = (m: Meeting) => new Date(m.startsAt).getTime();
  const oldestFirst = (a: Meeting, b: Meeting) => time(a) - time(b);
  const newestFirst = (a: Meeting, b: Meeting) => time(b) - time(a);
  const scheduled = meetings.filter((m) => m.status === 'scheduled');
  return {
    inProgress: scheduled.filter((m) => time(m) <= now).sort(oldestFirst),
    upcoming: scheduled.filter((m) => time(m) > now).sort(oldestFirst),
    awaitingCheck: meetings.filter((m) => m.status === 'completed' && !m.homeworkCheckedAt).sort(newestFirst),
    history: meetings
      .filter((m) => m.status === 'canceled' || (m.status === 'completed' && !!m.homeworkCheckedAt))
      .sort(newestFirst),
  };
}

/** True once the meeting's start time has passed (device clock): it can then be marked completed. */
export function hasStarted(meeting: Pick<Meeting, 'startsAt'>, now: number = Date.now()) {
  return new Date(meeting.startsAt).getTime() <= now;
}

/** ARU-45: attendance can be marked (and seen) once the meeting has started, until it is canceled. Mirrors
 *  mark_attendance() / unmark_attendance() (supabase/migrations/0022_attendance_from_start.sql), which use the
 *  database clock: a device clock that is ahead can show the button a little early, and the error then says so. */
export function isOpenForAttendance(meeting: Pick<Meeting, 'status' | 'startsAt'>, now: number = Date.now()) {
  return meeting.status !== 'canceled' && hasStarted(meeting, now);
}

/** A location that is a web link opens in the browser; anything else is a place. */
export function isLink(location: string | undefined): location is string {
  return !!location && /^https?:\/\/\S+$/i.test(location.trim());
}

export type MeetingBadgeInfo = { label: 'In progress' | 'Scheduled' | 'Completed' | 'Canceled'; bg: string; fg: string };

/** ARU-88: the badge a meeting shows. A Scheduled meeting whose start has passed reads "In progress" (display only;
 *  its status stays `scheduled`). `now` ticks on the course page, so the label switches without a refresh. */
export function meetingBadge(meeting: Pick<Meeting, 'status' | 'startsAt'>, now: number = Date.now()): MeetingBadgeInfo {
  if (meeting.status === 'completed') return { label: 'Completed', bg: colors.successSoft, fg: colors.success };
  if (meeting.status === 'canceled') return { label: 'Canceled', bg: '#F3F4F6', fg: colors.muted };
  return hasStarted(meeting, now)
    ? { label: 'In progress', bg: colors.successSoft, fg: colors.success }
    : { label: 'Scheduled', bg: colors.primarySoft, fg: colors.primary };
}

/** ARU-88: the colour of a meeting tile's left bar follows its group, not its badge (Awaiting homework check is amber
 *  although its badge says Completed); every MEETING HISTORY tile is grey. */
export const meetingAccent = {
  inProgress: colors.success,
  upcoming: colors.primary,
  awaitingCheck: colors.warning,
  history: colors.border,
} as const;
export type MeetingGroup = keyof typeof meetingAccent;
