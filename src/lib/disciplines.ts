import type { Course, CourseFeedback, User } from './types';

/** ARU-63 AC 5: what a course owner sees for a discipline hidden from them (no name). */
export const HIDDEN_DISCIPLINE = 'Hidden discipline';

/** The courses in a discipline the user can read (the teacher reads every course, hidden ones too). */
export function coursesInDiscipline(disciplineId: string, courses: Course[]) {
  return courses.filter((c) => c.disciplineId === disciplineId);
}

/**
 * ARU-63 AC 9 / AC 10: the feedback of a discipline's courses that the user can read, newest first. Feedback is
 * already limited by RLS (0025: a hidden course's feedback only for its owner, listeners and the teacher), so the
 * rating and the review list always count the same items.
 */
export function disciplineFeedback(disciplineId: string, courses: Course[], feedback: CourseFeedback[]) {
  const ids = new Set(coursesInDiscipline(disciplineId, courses).map((c) => c.id));
  return feedback.filter((f) => ids.has(f.courseId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** ARU-63: only the teacher creates disciplines and hides / unhides them (mirrors 0031's policies). */
export function canManageDisciplines(user: User | null | undefined) {
  return user?.role === 'teacher';
}
