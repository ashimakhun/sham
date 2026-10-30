import type { CourseMember, MeetingAttendance } from './types';

/**
 * Attendance of one meeting among the course's current listeners (ARU-33). Removed listeners don't count in either
 * number (their marks stay stored and count again if they are added back).
 */
export function meetingAttendance(meetingId: string, courseId: string, members: CourseMember[], marks: MeetingAttendance[]) {
  const listeners = members.filter((m) => m.courseId === courseId).map((m) => m.userId);
  const marked = new Set(marks.filter((a) => a.meetingId === meetingId).map((a) => a.userId));
  const attended = listeners.filter((id) => marked.has(id));
  const notMarked = listeners.filter((id) => !marked.has(id));
  return { attended, notMarked, total: listeners.length };
}
