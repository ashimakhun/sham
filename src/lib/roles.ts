import type { Homework, Role, User } from './types';

/** Mirrors the "teachers and mentors create courses" RLS policy (supabase/migrations/0003_courses.sql). */
export function canCreateCourse(role: Role | undefined) {
  return role === 'teacher' || role === 'mentor';
}

/** Mirrors the course_members insert policy and remove_listener() (supabase/migrations/0004_course_members.sql). */
export function canManageListeners(role: Role | undefined) {
  return role === 'teacher' || role === 'mentor';
}

/** Mirrors the homework update policy (supabase/migrations/0005_homework_by_course.sql): any mentor or the
 *  teacher checks unchecked homework, never their own. */
export function canCheckHomework(user: User | null | undefined, item: Homework) {
  return (
    (user?.role === 'mentor' || user?.role === 'teacher') && item.status === 'submitted' && item.studentId !== user.id
  );
}
