import type { useStore } from '@/lib/store';
import type { Course, CourseMember, Homework, User } from '@/lib/types';

type Store = ReturnType<typeof useStore>;

// Same people and courses as the TEST DESIGN in Linear and supabase/tests.
export const users: Record<string, User> = {
  T: { id: 'T', name: 'Teacher Tess', role: 'teacher' },
  M: { id: 'M', name: 'Mentor Max', role: 'mentor' },
  N: { id: 'N', name: 'Mentor Nina', role: 'mentor' },
  M2: { id: 'M2', name: 'Mentor Mo', role: 'mentor' },
  S1: { id: 'S1', name: 'Student Sam', role: 'student' },
  S2: { id: 'S2', name: 'Student Sue', role: 'student' },
  S3: { id: 'S3', name: 'Abby Student', role: 'student' },
};

export const courseA: Course = {
  id: 'A',
  title: 'Algebra',
  description: 'Equations and more',
  createdById: 'M',
  createdAt: '2026-10-01T10:00:00.000Z',
};
export const courseB: Course = { id: 'B', title: 'Biology', description: '', createdById: 'N', createdAt: '2026-10-02T10:00:00.000Z' };

export const member = (courseId: string, userId: string, addedAt = '2026-10-05T10:00:00.000Z'): CourseMember => ({
  courseId,
  userId,
  addedById: 'M',
  addedAt,
});

export const hw = (over: Partial<Homework> & { id: string }): Homework => ({
  studentId: 'S1',
  title: `Homework ${over.id}`,
  description: '',
  status: 'submitted',
  createdAt: '2026-10-10T10:00:00.000Z',
  ...over,
});

/** A store as useStore() returns it, signed in as `who`, with jest.fn() actions. */
export function fakeStore(who: keyof typeof users | null, over: Partial<Store> = {}): Store {
  const all = Object.values(users);
  const courses = over.courses ?? [courseB, courseA];
  return {
    ready: true,
    session: null,
    currentUser: who ? users[who] : null,
    users: all,
    materials: [],
    courses,
    courseMembers: [],
    visibleHomework: [],
    meetings: [],
    loading: false,
    dataLoaded: true,
    refresh: jest.fn(async () => {}),
    getUser: (id) => all.find((u) => u.id === id),
    getCourse: (id) => courses.find((c) => c.id === id),
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    addHomework: jest.fn(async () => {}),
    checkHomework: jest.fn(async () => {}),
    addMaterial: jest.fn(async () => {}),
    addCourse: jest.fn(async () => {}),
    addListeners: jest.fn(async () => {}),
    changeCourseOwner: jest.fn(async () => {}),
    countListenerHomework: jest.fn(async () => 0),
    removeListener: jest.fn(async () => {}),
    deleteMaterial: jest.fn(async () => {}),
    addMeeting: jest.fn(async () => {}),
    setMeetingStatus: jest.fn(async () => {}),
    loadMessages: jest.fn(async () => ({ messages: [], hasMore: false })),
    sendMessage: jest.fn(async () => {}),
    subscribeToMessages: jest.fn(() => () => {}),
    setUserRole: jest.fn(async () => {}),
    ...over,
  };
}
