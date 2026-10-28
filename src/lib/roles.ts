import type { Role } from './types';

/** Mirrors the "teachers and mentors create courses" RLS policy (supabase/migrations/0003_courses.sql). */
export function canCreateCourse(role: Role | undefined) {
  return role === 'teacher' || role === 'mentor';
}
