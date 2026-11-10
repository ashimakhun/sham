// QA ARU-40: hidden courses, screen-side gaps (switch accessibility, the label as part of the card's spoken text,
// who sees the course in which list, and every course-scoped screen's not-found state after access is lost).
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentType } from 'react';

import CoursesScreen from '@/app/(tabs)/courses';
import ChatScreen from '@/app/courses/[id]/chat';
import ListenersScreen from '@/app/courses/[id]/listeners';
import MeetingScreen from '@/app/courses/[id]/meetings/[meetingId]';
import AssignHomeworkScreen from '@/app/courses/[id]/meetings/[meetingId]/assign-homework';
import AttendanceScreen from '@/app/courses/[id]/meetings/[meetingId]/attendance';
import NotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import OwnerScreen from '@/app/courses/[id]/owner';
import NewCourseScreen from '@/app/courses/new';
import HomeworkScreen from '@/app/homework/[id]';
import type { Course, Meeting } from '@/lib/types';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const H: Course = { id: 'H', title: 'Secret', description: 'Private', createdById: 'M', createdAt: '2026-10-04T10:00:00.000Z', hidden: true };
const meetingH: Meeting = {
  id: 'mh',
  courseId: 'H',
  startsAt: '2026-10-20T10:00:00.000Z',
  topic: 'Hidden topic',
  status: 'completed',
  createdById: 'M',
  createdAt: '2026-10-10T10:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params) as (keyof typeof params)[]) delete params[k];
});

describe('AC 1 / edge case iOS-Android: the switch', () => {
  it('is a switch named "Hidden course", off, with the hint, and its state follows taps', async () => {
    setStore(fakeStore('M'));
    await render(<NewCourseScreen />);
    const sw = screen.getByRole('switch', { name: 'Hidden course' });
    expect(sw.props.value).toBe(false);
    expect(sw.props.accessibilityHint).toBe('Only the owner, listeners and the teacher will see this course.');
    await fireEvent(sw, 'valueChange', true);
    expect(screen.getByRole('switch', { name: 'Hidden course' }).props.value).toBe(true);
    await fireEvent(screen.getByRole('switch', { name: 'Hidden course' }), 'valueChange', false);
    expect(screen.getByRole('switch', { name: 'Hidden course' }).props.value).toBe(false);
  });

  it('turned on and off again, the course is created exactly as today (no hidden field)', async () => {
    const store = fakeStore('T');
    setStore(store);
    await render(<NewCourseScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Algebra — Grade 7'), 'Open course');
    await fireEvent(screen.getByRole('switch', { name: 'Hidden course' }), 'valueChange', true);
    await fireEvent(screen.getByRole('switch', { name: 'Hidden course' }), 'valueChange', false);
    await fireEvent.press(screen.getByRole('button', { name: 'Create course' }));
    expect(store.addCourse).toHaveBeenCalledTimes(1);
    expect(store.addCourse).toHaveBeenCalledWith({ id: expect.any(String), title: 'Open course', description: '' });
  });
});

describe('AC 2: who sees it where, with the label', () => {
  const label = (name: RegExp) => screen.getAllByRole('button', { name }).filter((b) => !/^Open chat/.test(b.props.accessibilityLabel ?? ''));

  // Updated for ARU-63: "All courses" is gone; courses with no discipline are listed under "No discipline" (AC 8).
  it('a student listener sees it once, under Courses I\'m in (not again under No discipline); the label is spoken', async () => {
    setStore(fakeStore('S1', { courses: [H, courseA], courseMembers: [member('H', 'S1')] }));
    await render(<CoursesScreen />);
    expect(screen.getByText(/COURSES I'M IN/)).toBeTruthy();
    expect(screen.getByText('NO DISCIPLINE')).toBeTruthy(); // Algebra
    expect(label(/Secret.*Hidden/s).length).toBe(1);
  });

  it('the teacher sees it under No discipline with the label, and not under Courses I own', async () => {
    setStore(fakeStore('T', { courses: [H, courseA], courseMembers: [] }));
    await render(<CoursesScreen />);
    expect(screen.queryByText(/COURSES I OWN/)).toBeNull();
    expect(screen.getByText('NO DISCIPLINE')).toBeTruthy();
    expect(label(/Secret.*Hidden/s).length).toBe(1);
  });

  it('ARU-63: once it has a discipline, the teacher (not owner or listener) no longer finds it on the Courses view', async () => {
    setStore(fakeStore('T', { courses: [{ ...H, disciplineId: 'D1' }, courseA], courseMembers: [] }));
    await render(<CoursesScreen />);
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.getByText('Algebra')).toBeTruthy();
  });

  it('a mentor listener sees it under Courses I\'m in with the label', async () => {
    setStore(fakeStore('M2', { courses: [H, courseB], courseMembers: [member('H', 'M2')] }));
    await render(<CoursesScreen />);
    expect(screen.getByText(/COURSES I'M IN/)).toBeTruthy();
    expect(label(/Secret.*Hidden/s).length).toBe(1);
  });

  it('a 200-character hidden title is cut at 2 lines and the label stays on the card', async () => {
    const long = { ...H, title: 'L'.repeat(200) };
    setStore(fakeStore('M', { courses: [long] }));
    await render(<CoursesScreen />);
    expect(screen.getByText('L'.repeat(200)).props.numberOfLines).toBe(2);
    expect(screen.getByText('Hidden')).toBeTruthy();
  });
});

describe('AC 3 / edge case: empty states', () => {
  it.each([
    ['S2', 'You are not in any course yet'],
    ['N', "You don't own or attend any course yet"], // ARU-63: the Courses view's mentor empty state
  ] as const)('%s whose only course is hidden (not returned by the database) sees today\'s empty state', async (who, empty) => {
    setStore(fakeStore(who, { courses: [], courseMembers: [] }));
    await render(<CoursesScreen />);
    expect(screen.getByText(empty)).toBeTruthy();
  });
});

describe('AC 8 / AC 10: every course screen shows its not-found state once the course is gone from the store', () => {
  const withH = (who: 'S1' | 'M2') =>
    fakeStore(who, {
      courses: [H, courseA],
      courseMembers: [member('H', 'S1'), member('H', 'M2')],
      meetings: [meetingH],
      visibleHomework: [hw({ id: 'hh', studentId: 'S1', courseId: 'H', title: 'Hidden homework' } as never)],
    });
  const without = (who: 'S1' | 'M2' | 'S2' | 'N') =>
    fakeStore(who, { courses: [courseA], courseMembers: [], meetings: [], visibleHomework: [] });

  const cases: [string, ComponentType, 'Course not found' | 'Meeting not found' | 'Homework not found', 'S1' | 'M2'][] = [
    ['chat', ChatScreen, 'Course not found', 'S1'],
    ['listeners', ListenersScreen, 'Course not found', 'M2'],
    ['owner', OwnerScreen, 'Course not found', 'M2'],
    ['meeting', MeetingScreen, 'Meeting not found', 'S1'],
    ['notes', NotesScreen, 'Meeting not found', 'S1'],
    ['attendance', AttendanceScreen, 'Meeting not found', 'M2'],
    ['assign homework', AssignHomeworkScreen, 'Meeting not found', 'M2'],
    ['homework', HomeworkScreen, 'Homework not found', 'M2'],
  ];

  it.each(cases)('%s: a removed listener sees its not-found state after the reload', async (_n, Screen, notFound, who) => {
    params.id = _n === 'homework' ? 'hh' : 'H';
    params.meetingId = 'mh';
    setStore(withH(who));
    const view = await render(<Screen />);
    expect(screen.queryByText(notFound)).toBeNull();
    setStore(without(who));
    await view.rerender(<Screen />);
    expect(screen.getByText(notFound)).toBeTruthy();
    expect(screen.queryByText(/Secret|Hidden topic|Hidden homework/)).toBeNull();
  });

  it.each(cases)('%s: opened by link by a non-participant, shows only its not-found state', async (_n, Screen, notFound) => {
    params.id = _n === 'homework' ? 'hh' : 'H';
    params.meetingId = 'mh';
    for (const who of ['S2', 'N'] as const) {
      setStore(without(who));
      const view = await render(<Screen />);
      // A student gets the screen's existing role refusal first on staff-only screens: also no content.
      expect(screen.queryByText(notFound) ?? (who === 'S2' ? screen.queryByText('Not allowed') : null)).toBeTruthy();
      expect(screen.queryByText(/Secret|Hidden topic|Hidden homework/)).toBeNull();
      await view.unmount();
    }
  });
});
