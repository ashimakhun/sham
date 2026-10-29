// ARU-24 QA additions (post-merge) to aru24-limited-courses.test.tsx, from the TEST DESIGN: the All courses card
// switching both ways on a live membership change (AC 7), the remaining deep links (AC 8: meetings/<id>, and the chat
// never loading the course's messages), empty description on the card and the screen with no empty line, role changes
// through the store, the student empty states (AC 3/4), and a listener's full screen keeping meetings and listeners.
import { fireEvent, render, screen } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import ChatScreen from '@/app/courses/[id]/chat';
import EditMeetingScreen from '@/app/courses/[id]/meetings/[meetingId]';
import { formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';

import { courseA, courseB, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courseC: Course = { id: 'C', title: 'Chemistry', description: '', createdById: 'N', createdAt: '2026-10-03T10:00:00.000Z' };
const courses = [courseC, courseB, courseA];
const ownerB = `Mentor Nina · ${formatDate(courseB.createdAt)}`;
const showAll = () => fireEvent.press(screen.getByRole('tab', { name: 'All courses' }));
beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'B';
  params.meetingId = undefined;
});

describe('All courses card', () => {
  it('AC7: the card switches to full when S1 is added to B, and back to limited when removed', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: [member('A', 'S1')] }));
    const view = await render(<CoursesScreen />);
    await showAll();
    expect(screen.queryByText(ownerB)).toBeNull();
    setStore(fakeStore('S1', { courses, courseMembers: [member('A', 'S1'), member('B', 'S1')] }));
    await view.rerender(<CoursesScreen />);
    expect(screen.getByText(ownerB)).toBeTruthy();
    setStore(fakeStore('S1', { courses, courseMembers: [member('A', 'S1')] }));
    await view.rerender(<CoursesScreen />);
    expect(screen.queryByText(ownerB)).toBeNull();
  });

  it('edge: limited cards show only title and description; an empty description leaves no empty line', async () => {
    setStore(fakeStore('S2', { courses }));
    const { container } = await render(<CoursesScreen />);
    await showAll();
    const texts = container.queryAll((n) => n.type === 'Text').map((n) => [n.props.children].flat().join(''));
    // Chemistry and Biology have empty descriptions; Algebra has one. No owner line, no date, no empty Text.
    expect(texts).toEqual(['My courses', 'All courses', 'Chemistry', 'Biology', 'Algebra', 'Equations and more']);
  });

  it('AC3: S2 (in nothing) still sees every course, as many as a mentor', async () => {
    setStore(fakeStore('S2', { courses }));
    const view = await render(<CoursesScreen />);
    await showAll();
    const forStudent = screen.getAllByText(/^(Algebra|Biology|Chemistry)$/).length;
    setStore(fakeStore('M2', { courses }));
    await view.rerender(<CoursesScreen />);
    expect(screen.getAllByText(/^(Algebra|Biology|Chemistry)$/)).toHaveLength(forStudent);
    expect(forStudent).toBe(3);
  });

  it('AC3/AC4: empty states for a student are unchanged', async () => {
    setStore(fakeStore('S2', { courses: [] }));
    await render(<CoursesScreen />);
    expect(screen.getByText('You are not in any course yet')).toBeTruthy();
    await showAll();
    expect(screen.getByText('No courses yet')).toBeTruthy();
    expect(screen.getByText('Your teacher or mentor has not created any courses yet.')).toBeTruthy();
  });

  it('edge (role change): a mentor made student sees limited cards; a student made mentor sees full ones', async () => {
    const asStudent = { ...users.M2, role: 'student' as const };
    setStore(fakeStore('M2', { courses, currentUser: asStudent }));
    const view = await render(<CoursesScreen />);
    await showAll();
    expect(screen.queryAllByText(/Owner:/)).toHaveLength(0);
    const asMentor = { ...users.S2, role: 'mentor' as const };
    setStore(fakeStore('S2', { courses, currentUser: asMentor }));
    await view.rerender(<CoursesScreen />);
    expect(screen.getAllByText(/Owner:/)).toHaveLength(3);
  });
});

describe('Course screen', () => {
  it('edge: the limited screen with an empty description has no empty text', async () => {
    params.id = 'C';
    setStore(fakeStore('S2', { courses }));
    const { container } = await render(<CourseDetailScreen />);
    const texts = container.queryAll((n) => n.type === 'Text').map((n) => [n.props.children].flat().join(''));
    expect(texts).toEqual(['Chemistry', 'You are not in this course', 'Ask your teacher or mentor to add you.']);
  });

  it('AC6: a listener student keeps meetings and listeners on the full screen', async () => {
    params.id = 'A';
    setStore(fakeStore('S1', { courses, courseMembers: [member('A', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText(/^MEETINGS/)).toBeTruthy();
    expect(screen.getByText(/^LISTENERS/)).toBeTruthy();
    expect(screen.getByText(/Owner:/)).toBeTruthy();
  });
});

describe('AC8: remaining deep links stay denied and leak nothing', () => {
  it('meetings/<id>: with RLS hiding the meeting the screen says "Meeting not found"', async () => {
    params.meetingId = 'mt1';
    setStore(fakeStore('S2', { courses, meetings: [] }));
    await render(<EditMeetingScreen />);
    expect(screen.getByText('Meeting not found')).toBeTruthy();
  });

  it('meetings/<id>: even if the meeting were in the store, a student gets "Not allowed" and not its topic', async () => {
    params.meetingId = 'mt1';
    const meeting = {
      id: 'mt1',
      courseId: 'B',
      startsAt: '2030-01-01T10:00:00.000Z',
      topic: 'Secret topic',
      status: 'scheduled' as const,
      createdById: 'N',
      createdAt: '2026-10-01T10:00:00.000Z',
    };
    setStore(fakeStore('S2', { courses, meetings: [meeting] as never }));
    await render(<EditMeetingScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByText('Secret topic')).toBeNull();
    expect(screen.queryByDisplayValue('Secret topic')).toBeNull();
  });

  it('chat: the course\'s messages are never requested or subscribed to', async () => {
    const store = fakeStore('S2', { courses });
    setStore(store);
    await render(<ChatScreen />);
    expect(screen.getByText('You are no longer in this course')).toBeTruthy();
    expect(store.loadMessages).not.toHaveBeenCalled();
    expect(store.subscribeToMessages).not.toHaveBeenCalled();
  });
});
