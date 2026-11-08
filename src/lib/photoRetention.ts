// ARU-107 (part a): the 6-month rule for homework photos. Nothing is deleted yet (ARU-112 is the daily job); the app
// shows each photo's deletion date, warns 30 days before and lets the sender download their photos as a ZIP.
import type { Homework } from './types';

export const PHOTO_RULE = 'Photos are kept for 6 months after the homework is checked, then deleted.';
/** ARU-112 AC 6: shown in place of a photo the daily job removed. */
export const PHOTO_REMOVED = 'Photo removed 6 months after checking';
export const PHOTOS_ZIP_ERROR = "Couldn't prepare your photos. Check your connection and try again.";
/** At most this many photos in one ZIP (the server's PHOTO_ZIP_MAX); more opens Download by course (AC 6). */
export const PHOTO_ZIP_MAX = 50;
/** The banner shows photos whose deletion date is at most this many days away (AC 4). */
export const WARNING_DAYS = 30;

/** The UTC calendar date of an instant, YYYY-MM-DD. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** YYYY-MM-DD plus `months` calendar months; a day the month doesn't have becomes its last day (31 Aug → 28/29 Feb),
 *  as Postgres's `date + interval 'n months'`. */
export function addMonths(day: string, months: number) {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return utcDay(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))));
}

export function addDays(day: string, days: number) {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000));
}

/**
 * AC 3, the same rule as photo_deletion_date() in migration 0050: the UTC date of the check + 6 months, never before
 * the deletion start date. Null while the start date is empty (AC 2) or for homework that isn't checked.
 */
export function photoDeletionDate(checkedAt: string | undefined, start: string | null | undefined): string | null {
  if (!checkedAt || !start) return null;
  const date = addMonths(utcDay(new Date(checkedAt)), 6);
  return date < start ? start : date;
}

/** A UTC date (YYYY-MM-DD) in the app's usual date format, unchanged by the device's time zone. */
export function formatUtcDate(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Homework the user sent whose photo is still stored (a missing file has no signed URL). */
export function storedOwnPhotos(homework: Homework[], userId: string | undefined) {
  return homework.filter((h) => !!userId && h.studentId === userId && !!h.photoPath && !!h.photoUrl);
}

/** AC 4: the user's stored photos with a deletion date within WARNING_DAYS, and the earliest date; null when none. */
export function deletionWarning(
  homework: Homework[],
  userId: string | undefined,
  start: string | null | undefined,
  now: Date = new Date(),
): { count: number; date: string } | null {
  const limit = addDays(utcDay(now), WARNING_DAYS);
  const dates = storedOwnPhotos(homework, userId)
    .filter((h) => h.status === 'checked')
    .map((h) => photoDeletionDate(h.checkedAt, start))
    .filter((d): d is string => !!d && d <= limit)
    .sort();
  return dates.length ? { count: dates.length, date: dates[0] } : null;
}

export function deletionWarningText({ count, date }: { count: number; date: string }) {
  return `${count} homework ${count === 1 ? 'photo' : 'photos'} will be deleted on ${formatUtcDate(date)}. Download them now.`;
}

export type ZipEntry = { key: string; courseId: string; title: string; part: number; parts: number; count: number };

/** AC 6: one entry per course with photos, a course over PHOTO_ZIP_MAX in parts; sorted by course title. */
export function zipEntries(photos: Homework[], courseTitle: (courseId: string) => string | undefined): ZipEntry[] {
  const byCourse = new Map<string, number>();
  for (const h of photos) if (h.courseId) byCourse.set(h.courseId, (byCourse.get(h.courseId) ?? 0) + 1);
  return [...byCourse]
    .map(([courseId, n]) => ({ courseId, n, title: courseTitle(courseId) ?? 'Course' }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.courseId.localeCompare(b.courseId))
    .flatMap(({ courseId, n, title }) => {
      const parts = Math.ceil(n / PHOTO_ZIP_MAX);
      return Array.from({ length: parts }, (_, i) => ({
        key: `${courseId}:${i + 1}`,
        courseId,
        title,
        part: i + 1,
        parts,
        count: Math.min(PHOTO_ZIP_MAX, n - i * PHOTO_ZIP_MAX),
      }));
    });
}
