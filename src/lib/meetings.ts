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

/** ARU-190: a Completed meeting with no homework moves to MEETING HISTORY this long after it was marked Completed. */
export const AUTO_HISTORY_MS = 24 * 60 * 60 * 1000;

/** ARU-190: a Completed, unchecked meeting that got no homework within a day of being marked Completed (display only,
 *  nothing is saved). `withHomework` is the IDs of meetings that have homework; `null` (not loaded) never moves one.
 *  A meeting without `statusChangedAt` (written outside set_meeting_status()) stays in Awaiting homework check. */
export function isAutoHistory(
  m: Pick<Meeting, 'id' | 'status' | 'homeworkCheckedAt' | 'statusChangedAt'>,
  now: number,
  withHomework: ReadonlySet<string> | null,
) {
  if (m.status !== 'completed' || m.homeworkCheckedAt || !withHomework || withHomework.has(m.id)) return false;
  const changed = m.statusChangedAt ? Date.parse(m.statusChangedAt) : NaN;
  return Number.isFinite(changed) && now - changed >= AUTO_HISTORY_MS;
}

/** ARU-60: the course page's meeting groups (device clock, like sortMeetings).
 *  - inProgress: Scheduled and started, oldest start first
 *  - upcoming: Scheduled, start in the future, soonest first
 *  - awaitingCheck: Completed and homework not marked checked, newest first
 *  - history: Completed and checked, or Canceled, newest first (shown at the bottom of the page)
 *  ARU-190: also history: Completed with no homework 24 h after it was marked Completed (see `isAutoHistory`). */
export function groupMeetings(
  meetings: Meeting[],
  now: number = Date.now(),
  withHomework: ReadonlySet<string> | null = null,
) {
  const time = (m: Meeting) => new Date(m.startsAt).getTime();
  const oldestFirst = (a: Meeting, b: Meeting) => time(a) - time(b);
  const newestFirst = (a: Meeting, b: Meeting) => time(b) - time(a);
  const scheduled = meetings.filter((m) => m.status === 'scheduled');
  const auto = (m: Meeting) => isAutoHistory(m, now, withHomework);
  return {
    inProgress: scheduled.filter((m) => time(m) <= now).sort(oldestFirst),
    upcoming: scheduled.filter((m) => time(m) > now).sort(oldestFirst),
    awaitingCheck: meetings
      .filter((m) => m.status === 'completed' && !m.homeworkCheckedAt && !auto(m))
      .sort(newestFirst),
    history: meetings
      .filter((m) => m.status === 'canceled' || (m.status === 'completed' && (!!m.homeworkCheckedAt || auto(m))))
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

/** ARU-88: the colour of a meeting tile's left bar follows its group, not its badge; every MEETING HISTORY tile is
 *  grey. ARU-126: Awaiting homework check is the theme colour (it was amber). */
export const meetingAccent = {
  inProgress: colors.success,
  upcoming: colors.primary,
  // ARU-126 AC 3: the theme colour instead of amber.
  awaitingCheck: colors.primary,
  history: colors.border,
} as const;
export type MeetingGroup = keyof typeof meetingAccent;
