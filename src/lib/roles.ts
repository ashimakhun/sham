import type { Course, CourseMember, Homework, Role, User } from './types';

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

/** Mirrors change_course_owner() (supabase/migrations/0007_course_owner.sql): the teacher or any mentor, including a
 *  mentor who is a listener of the course. */
export function canChangeOwner(role: Role | undefined) {
  return role === 'teacher' || role === 'mentor';
}
