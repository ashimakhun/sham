// ARU-170: local reminders, scheduled by the app on this phone from the data it has already loaded (no server).
// This file only decides WHAT to schedule (pure, tested with Jest); src/lib/reminderScheduler.ts talks to
// expo-notifications and the store calls it after every load, language change and switch change.
//
//   * Meeting started (AC 5-6): at the start time of every Scheduled, future meeting of a course I listen to.
//   * Homework due soon (AC 7-8): 24 hours before an assignment's due time, while more than 24 hours are left and I
//     haven't sent homework for it (any own homework row for the assignment counts, whatever its review status).
//   * Photo deletion (AC 10-11): at 09:00 phone time on the day 30 and the day 7 days before each of my stored photos'
//     deletion date; photos whose marks fall on the same day share one reminder.
// At most the 60 soonest are scheduled (AC 4; iOS keeps 64 pending notifications).
import { type Language, translate } from '@/i18n';

import { homeworkPhotos } from './photo';
import { addDays, formatUtcDate, photoDeletionDate } from './photoRetention';
import type { Course, CourseMember, Homework, HomeworkAssignment, Meeting, NotificationKind, Role } from './types';

/** Every reminder this app schedules has an identifier starting with this (and data.sham = 'reminder'). */
export const REMINDER_PREFIX = 'sham-reminder:';
/** AC 4: iOS keeps at most 64 pending notifications; the rest are scheduled by later loads. */
export const MAX_REMINDERS = 60;
/** AC 7: how long before the due time the Homework due soon reminder fires (one constant, product decision). */
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;
/** AC 10: the photo reminders' marks, in days before the deletion date, and their time of day (phone time). */
export const PHOTO_MARK_DAYS = [30, 7] as const;
export const PHOTO_REMINDER_HOUR = 9;

export type Reminder = {
  /** Stable per thing reminded about: sham-reminder:meeting:<id>, …:due:<assignment id>, …:photos:<YYYY-MM-DD>. */
  id: string;
  /** When it fires (ms since epoch). */
  fireAt: number;
  body: string;
};

export type ReminderInput = {
  userId: string;
  role: Role;
  /** The account's switches; a missing kind reads as on. */
  settings: Partial<Record<NotificationKind, boolean>>;
  courses: Course[];
  courseMembers: CourseMember[];
  meetings: Meeting[];
  assignments: HomeworkAssignment[];
  homework: Homework[];
  /** app_settings.photo_deletion_start (ARU-107); null until the daily job sets it. */
  photoDeletionStart: string | null;
  now: Date;
  /** The app language at scheduling time (AC 14). */
  lang: Language;
};

const on = (settings: ReminderInput['settings'], kind: NotificationKind) => settings[kind] !== false;

/** 09:00 phone time on a calendar day (YYYY-MM-DD), in the phone's current time zone. */
export function localNineOn(day: string, hour = PHOTO_REMINDER_HOUR): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
}

/** AC 5-11 and AC 4: the reminders to have on this phone now, soonest first, at most MAX_REMINDERS. */
export function remindersFor(input: ReminderInput): Reminder[] {
  const { userId, role, settings, now, lang } = input;
  // The teacher is never a listener and never sends homework (Roles and access).
  if (role === 'teacher') return [];
  const nowMs = now.getTime();
  const titles = new Map(input.courses.map((c) => [c.id, c]));
  // A course I listen to and don't own (the owner gets none, as today).
  const listening = new Set(
    input.courseMembers
      .filter((m) => m.userId === userId && titles.has(m.courseId) && titles.get(m.courseId)!.createdById !== userId)
      .map((m) => m.courseId),
  );
  const out: Reminder[] = [];

  // AC 5-6: meeting started.
  if (on(settings, 'meeting_started')) {
    for (const m of input.meetings) {
      if (m.status !== 'scheduled' || !listening.has(m.courseId)) continue;
      const fireAt = Date.parse(m.startsAt);
      if (!Number.isFinite(fireAt) || fireAt <= nowMs) continue;
      out.push({
        id: `${REMINDER_PREFIX}meeting:${m.id}`,
        fireAt,
        body: translate(lang, 'reminders.meetingStarted', { course: titles.get(m.courseId)!.title }),
      });
    }
  }

  // AC 7-8: homework due soon.
  if (on(settings, 'homework_due')) {
    const sent = new Set(input.homework.filter((h) => h.studentId === userId && h.assignmentId).map((h) => h.assignmentId));
    for (const a of input.assignments) {
      if (!a.dueAt || !listening.has(a.courseId) || sent.has(a.id)) continue;
      const due = Date.parse(a.dueAt);
      if (!Number.isFinite(due) || due - nowMs <= DUE_SOON_MS) continue;
      out.push({
        id: `${REMINDER_PREFIX}due:${a.id}`,
        fireAt: due - DUE_SOON_MS,
        body: translate(lang, 'reminders.homeworkDue', { course: titles.get(a.courseId)!.title, assignment: a.title }),
      });
    }
  }

  // AC 10-11: photo deletion. Own homework whose photo is still stored (photoPath set, not removed by the daily job),
  // with a deletion date (checked, and the start date set): the same rule as the job that deletes them.
  if (on(settings, 'photo_deletion') && input.photoDeletionStart) {
    const byDay = new Map<string, { count: number; earliest: string }>();
    for (const h of input.homework) {
      // ARU-191: count photos, not homework (the text says "N photos").
      const photos = homeworkPhotos(h).length;
      if (h.studentId !== userId || !photos || h.photoRemovedAt) continue;
      const deletion = photoDeletionDate(h.checkedAt, input.photoDeletionStart);
      if (!deletion) continue;
      for (const days of PHOTO_MARK_DAYS) {
        // Analysis note 4: the UTC deletion date minus 30 / 7 days as a calendar date, at 09:00 phone time that day.
        const day = addDays(deletion, -days);
        if (localNineOn(day) <= nowMs) continue;
        const group = byDay.get(day);
        if (!group) byDay.set(day, { count: photos, earliest: deletion });
        else {
          group.count += photos;
          if (deletion < group.earliest) group.earliest = deletion;
        }
      }
    }
    for (const [day, { count, earliest }] of byDay) {
      out.push({
        id: `${REMINDER_PREFIX}photos:${day}`,
        fireAt: localNineOn(day),
        body: translate(lang, 'reminders.photoDeletion', { count, date: formatUtcDate(earliest, lang) }),
      });
    }
  }

  return out.sort((a, b) => a.fireAt - b.fireAt || a.id.localeCompare(b.id)).slice(0, MAX_REMINDERS);
}

/** One string per reminder set: an unchanged set isn't rescheduled (analysis note 2). */
export const reminderSignature = (list: Reminder[]) => list.map((r) => `${r.id}|${r.fireAt}|${r.body}`).join('\n');
