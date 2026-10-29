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

/** Mirrors the course_meetings insert policy and set_meeting_status() (supabase/migrations/0010_course_meetings.sql):
 *  the course's current owner or the teacher (any course) schedules meetings and sets their status. */
export function canManageMeetings(user: User | null | undefined, course: Course) {
  return !!user && (course.createdById === user.id || user.role === 'teacher');
}

/** Mirrors the course_meetings select policy: the teacher and every mentor, or a listener of the course. */
export function canSeeMeetings(user: User | null | undefined, course: Course, members: CourseMember[]) {
  if (!user) return false;
  return (
    user.role === 'teacher' ||
    user.role === 'mentor' ||
    members.some((m) => m.courseId === course.id && m.userId === user.id)
  );
}

/** Mirrors change_course_owner() (supabase/migrations/0007_course_owner.sql): the teacher or any mentor, including a
 *  mentor who is a listener of the course. */
export function canChangeOwner(role: Role | undefined) {
  return role === 'teacher' || role === 'mentor';
}

/** Mirrors set_user_role() (supabase/migrations/0009_roles_screen.sql): only the teacher manages roles. */
export function canManageRoles(role: Role | undefined) {
  return role === 'teacher';
}

/** Mirrors is_member() (supabase/migrations/0004_course_members.sql): the user is a listener of the course. */
export function isCourseListener(user: User | null | undefined, course: Course, members: CourseMember[]) {
  return !!user && members.some((m) => m.courseId === course.id && m.userId === user.id);
}

/** ARU-24: a student who is not a listener of a course sees only its title and description (app-only; the
 *  courses table stays readable so titles can be listed). Mentors and the teacher always see everything. */
export function seesOnlyCourseSummary(user: User | null | undefined, course: Course, members: CourseMember[]) {
  return user?.role === 'student' && !isCourseListener(user, course, members);
}
