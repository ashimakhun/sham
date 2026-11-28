// ARU-197: a course its owner or the teacher marked Completed (supabase/migrations/0082_complete_course.sql). A
// completed course takes no new meeting, homework assignment or listener; everything else works as before, and its
// listeners can leave feedback even if no meeting was ever completed.
import { translate } from '@/i18n';

import { canManageMeetings } from './roles';
import type { Course, Meeting, User } from './types';

/** The course is completed (courses.completed_at is set); undefined counts as active. */
export function isCourseCompleted(course: Pick<Course, 'completedAt'> | null | undefined) {
  return !!course?.completedAt;
}

/** Mirrors complete_course() / reopen_course() (0082): the course's current owner, or the teacher on any course. */
export function canCompleteCourse(user: User | null | undefined, course: Course) {
  return canManageMeetings(user, course);
}

/** AC 4: active courses first, then completed ones; each group keeps the order it came in. */
export function completedLast<T extends Pick<Course, 'completedAt'>>(courses: T[]): T[] {
  return [...courses.filter((c) => !isCourseCompleted(c)), ...courses.filter((c) => isCourseCompleted(c))];
}

/** AC 2: how many of the course's meetings are Scheduled (one that has started but isn't marked counts). */
export function scheduledMeetingCount(meetings: Meeting[], courseId: string) {
  return meetings.filter((m) => m.courseId === courseId && m.status === 'scheduled').length;
}

/** What the store throws when Complete or Reopen gets no answer from the server (offline). */
export const COURSE_SAVE_FAILED = translate('en', 'notifications.saveFailed');
