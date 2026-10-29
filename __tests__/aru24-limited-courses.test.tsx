// ARU-24: students see only the title and description of courses they are not a listener of (app-only; RLS on
// chat, meetings, listeners and homework already denies them). Mentors and the teacher are unchanged.
// S1 is a listener of A (owned by M), not of B (owned by N); S2 is in nothing.
import { fireEvent, render, screen } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import ChatScreen from '@/app/courses/[id]/chat';
import AddListenersScreen from '@/app/courses/[id]/listeners';
import NewMeetingScreen from '@/app/courses/[id]/meetings/new';
import ChangeOwnerScreen from '@/app/courses/[id]/owner';
import { formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { router } from 'expo-router';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courseC: Course = { id: 'C', title: 'Chemistry', description: '', createdById: 'N', createdAt: '2026-10-03T10:00:00.000Z' };
const courses = [courseC, courseB, courseA];
const members = [member('A', 'S1')];
const ownerA = `Mentor Max · ${formatDate(courseA.createdAt)}`;
const ownerB = `Mentor Nina · ${formatDate(courseB.createdAt)}`;
const ownerC = `Mentor Nina · ${formatDate(courseC.createdAt)}`;
const showAll = () => fireEvent.press(screen.getByRole('tab', { name: 'All courses' }));

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'B';
});

describe('All courses list', () => {
  it('AC1/AC2/AC3: S1 sees every course newest first; owner line only on the course they are in', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    await showAll();
    expect(screen.getAllByText(/^(Algebra|Biology|Chemistry)$/).map((t) => t.props.children)).toEqual([
      'Chemistry',
      'Biology',
      'Algebra',
    ]);
    expect(screen.getByText(ownerA)).toBeTruthy();
    expect(screen.queryByText(ownerB)).toBeNull();
    expect(screen.queryByText(ownerC)).toBeNull();
    expect(screen.queryByText(/Owner:/)).toBeTruthy(); // only A's line
    expect(screen.getAllByText(/Owner:/)).toHaveLength(1);
  });

  it('AC1: a limited card still opens the course', async () => {
    setStore(fakeStore('S2', { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    await showAll();
    expect(screen.queryAllByText(/Owner:/)).toHaveLength(0);
    await fireEvent.press(screen.getByText('Biology'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'B' } });
  });

  it('AC4: My courses is unchanged (only A, tagged Listener, full card)', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    expect(screen.getByText('Listener')).toBeTruthy();
    expect(screen.getByText('Algebra')).toBeTruthy();
    expect(screen.queryByText('Biology')).toBeNull();
    expect(screen.getByText(ownerA)).toBeTruthy();
  });

  it.each(['M', 'N', 'T'] as const)('AC9: %s sees full cards for every course', async (who) => {
    setStore(fakeStore(who, { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    await showAll();
    expect(screen.getAllByText(/Owner:/)).toHaveLength(3);
  });
});

describe('Course details', () => {
  it('AC5: S1 on a course they are not in sees title, description and "not in this course" only', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members, visibleHomework: [hw({ id: 'h1', courseId: 'A' })] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Biology')).toBeTruthy();
    expect(screen.getByText('You are not in this course')).toBeTruthy();
    expect(screen.getByText('Ask your teacher or mentor to add you.')).toBeTruthy();
    for (const hidden of [/Owner:/, 'HOMEWORK', 'No homework for this course yet', /^MEETINGS/, /^LISTENERS/]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    for (const button of ['Chat', 'Change owner', '+ Schedule meeting', '+ Add listeners']) {
      expect(screen.queryByRole('button', { name: button })).toBeNull();
    }
  });

  it('edge: an empty description shows only the title', async () => {
    params.id = 'C';
    setStore(fakeStore('S2', { courses, courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Chemistry')).toBeTruthy();
    expect(screen.getByText('You are not in this course')).toBeTruthy();
  });

  it('AC6: S1 on their own course sees the full screen', async () => {
    params.id = 'A';
    setStore(fakeStore('S1', { courses, courseMembers: members, visibleHomework: [hw({ id: 'h1', courseId: 'A' })] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText(ownerA)).toBeTruthy();
    expect(screen.getByText('HOMEWORK')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chat' })).toBeTruthy();
    expect(screen.queryByText('You are not in this course')).toBeNull();
  });

  it('AC7: added as a listener (live refetch) → full screen; removed → limited again', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    const view = await render(<CourseDetailScreen />);
    expect(screen.getByText('You are not in this course')).toBeTruthy();
    setStore(fakeStore('S1', { courses, courseMembers: [...members, member('B', 'S1')] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByText('You are not in this course')).toBeNull();
    expect(screen.getByText(ownerB)).toBeTruthy();
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.getByText('You are not in this course')).toBeTruthy();
  });

  it('AC7: pull-to-refresh works on the limited screen', async () => {
    const store = fakeStore('S2', { courses, courseMembers: members });
    setStore(store);
    await render(<CourseDetailScreen />);
    const scroll = screen.getByText('Biology');
    let node = scroll.parent;
    while (node && !node.props.refreshControl) node = node.parent;
    await node!.props.refreshControl.props.onRefresh();
    expect(store.refresh).toHaveBeenCalled();
  });

  it.each(['M', 'N', 'T'] as const)('AC9: %s sees the full screen of a course they are not in', async (who) => {
    params.id = who === 'N' ? 'A' : 'B';
    setStore(fakeStore(who, { courses, courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText(/Owner:/)).toBeTruthy();
    expect(screen.getByText('HOMEWORK')).toBeTruthy();
    expect(screen.queryByText('You are not in this course')).toBeNull();
  });

  it('edge: an unknown course still shows "Course not found"', async () => {
    params.id = 'nope';
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Course not found')).toBeTruthy();
  });
});

describe('AC8: deep links into a course the student is not in stay denied', () => {
  it('chat', async () => {
    setStore(fakeStore('S2', { courses, courseMembers: members }));
    await render(<ChatScreen />);
    expect(screen.getByText('You are no longer in this course')).toBeTruthy();
  });

  it.each([
    ['listeners', AddListenersScreen],
    ['owner', ChangeOwnerScreen],
    ['meetings/new', NewMeetingScreen],
  ])('%s', async (_name, Screen) => {
    setStore(fakeStore('S2', { courses, courseMembers: members }));
    await render(<Screen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });
});
