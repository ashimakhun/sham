import type { Meeting } from './types';

/** Upcoming (Scheduled, start still in the future) soonest first, then everything else newest first (ARU-10 AC 2).
 *  Uses the device clock; the database's clock decides what may be saved. */
export function sortMeetings(meetings: Meeting[], now: number = Date.now()) {
  const time = (m: Meeting) => new Date(m.startsAt).getTime();
  const upcoming = meetings.filter((m) => m.status === 'scheduled' && time(m) > now).sort((a, b) => time(a) - time(b));
  const past = meetings.filter((m) => !upcoming.includes(m)).sort((a, b) => time(b) - time(a));
  return { upcoming, past };
}

/** True once the meeting's start time has passed (device clock): it can then be marked completed. */
export function hasStarted(meeting: Pick<Meeting, 'startsAt'>, now: number = Date.now()) {
  return new Date(meeting.startsAt).getTime() <= now;
}

/** A location that is a web link opens in the browser; anything else is a place. */
export function isLink(location: string | undefined): location is string {
  return !!location && /^https?:\/\/\S+$/i.test(location.trim());
}
