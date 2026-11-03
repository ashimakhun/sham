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
