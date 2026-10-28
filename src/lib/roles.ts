import type { Course, CourseMember, Role, User } from './types';

/** Mirrors the "teachers and mentors create courses" RLS policy (supabase/migrations/0003_courses.sql). */
export function canCreateCourse(role: Role | undefined) {
  return role === 'teacher' || role === 'mentor';
}

/** Mirrors the course_members insert policy and remove_listener() (supabase/migrations/0004_course_members.sql). */
export function canManageListeners(role: Role | undefined) {
  return role === 'teacher' || role === 'mentor';
}

/** Mirrors in_course_chat() (supabase/migrations/0006_course_chat.sql): the course owner, its listeners and the
 *  teacher are in the course chat. */
export function inCourseChat(user: User | null | undefined, course: Course, members: CourseMember[]) {
  if (!user) return false;
  return (
    user.role === 'teacher' ||
    course.createdById === user.id ||
    members.some((m) => m.courseId === course.id && m.userId === user.id)
  );
}
