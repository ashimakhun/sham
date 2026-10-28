// ARU-12 QA: cases from the TEST DESIGN that aru12-my-courses.test.tsx does not cover yet —
// re-selecting "My courses" on focus, other users' memberships, owner changes, failed refresh.
import { fireEvent, render, screen } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import type { Course } from '@/lib/types';
import { router } from 'expo-router';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courseC: Course = { id: 'C', title: 'Chemistry', description: '', createdById: 'N', createdAt: '2026-10-03T10:00:00.000Z' };
const courses = [courseC, courseB, courseA];
// S1 in A and B; M (owner of A) in B.
const courseMembers = [member('A', 'S1'), member('B', 'S1'), member('B', 'M')];
const store = (who: Parameters<typeof fakeStore>[0], over = {}) => fakeStore(who, { courses, courseMembers, ...over });

const tab = (name: string) => screen.getByRole('tab', { name });
const titles = () => screen.queryAllByText(/^(Algebra|Biology|Chemistry)$/).map((t) => t.props.children);
const headings = () => screen.queryAllByText(/^COURSES I/).map((t) => t.props.children);

beforeEach(() => jest.clearAllMocks());

describe('AC1: "My courses" is selected each time the tab is opened', () => {
  it('re-entering the tab after "All courses" selects "My courses" again', async () => {
    setStore(store('S1'));
    await render(<CoursesScreen />);
    await fireEvent.press(tab('All courses'));
    expect(tab('All courses')).toBeSelected();
    await refocus(); // switch to another tab and back
    expect(tab('My courses')).toBeSelected();
    expect(titles()).toEqual(['Biology', 'Algebra']);
  });

  it('coming back from a course opened in "All courses" keeps "All courses"', async () => {
    setStore(store('S1'));
    await render(<CoursesScreen />);
    await fireEvent.press(tab('All courses'));
    await fireEvent.press(screen.getByText('Chemistry'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'C' } });
    await refocus(); // back from course details
    expect(tab('All courses')).toBeSelected();
    await refocus(); // later: another tab and back
    expect(tab('My courses')).toBeSelected();
  });

  it('coming back from "+ New course" keeps the current view', async () => {
    setStore(store('N'));
    await render(<CoursesScreen />);
    await fireEvent.press(tab('All courses'));
    await fireEvent.press(screen.getByRole('button', { name: '+ New course' }));
    expect(router.push).toHaveBeenCalledWith('/courses/new');
    await refocus();
    expect(tab('All courses')).toBeSelected();
  });
});

describe('access: only my own memberships count', () => {
  it('AC6: a mentor who can read every membership row sees none of other people\'s courses as theirs', async () => {
    setStore(store('M2'));
    await render(<CoursesScreen />);
    expect(titles()).toEqual([]);
    expect(screen.getByText("You don't own or attend any course yet")).toBeTruthy();
  });

  it('AC4/AC6: a student listener of A and B never gets a "Courses I own" section, and C stays out', async () => {
    setStore(store('S1'));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(["COURSES I'M IN"]);
    expect(titles()).not.toContain('Chemistry');
    await fireEvent.press(tab('All courses'));
    expect(titles()).toEqual(['Chemistry', 'Biology', 'Algebra']); // AC6: still in "All courses"
  });

  it('roles: the teacher only has "Courses I own"', async () => {
    setStore(store('T', { courses: [{ ...courseC, id: 'D', title: 'Algebra', createdById: 'T' }] }));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(['COURSES I OWN']);
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('AC5: owning wins if bad data ever lists the owner as a listener too (no duplicates)', async () => {
    setStore(store('M', { courseMembers: [...courseMembers, member('A', 'M')] }));
    await render(<CoursesScreen />);
    expect(titles()).toEqual(['Biology', 'Algebra']);
    expect(screen.getAllByText('Owner')).toHaveLength(1);
    expect(screen.getAllByText('Listener')).toHaveLength(1);
  });
});

it('AC10: when the owner changes, the course moves between owners\' "Courses I own"', async () => {
  setStore(store('M2'));
  const { rerender } = await render(<CoursesScreen />);
  expect(titles()).toEqual([]);
  const moved = [{ ...courseC, createdById: 'M2' }, courseB, courseA];
  setStore(store('M2', { courses: moved }));
  await rerender(<CoursesScreen />);
  expect(headings()).toEqual(['COURSES I OWN']);
  expect(titles()).toEqual(['Chemistry']);
  setStore(store('N', { courses: moved }));
  await rerender(<CoursesScreen />);
  expect(titles()).toEqual(['Biology']);
});

it('edge: a failed pull-to-refresh keeps the list and does not crash', async () => {
  const refresh = jest.fn().mockRejectedValue(new Error('Network request failed'));
  setStore(store('S1', { refresh }));
  const { container } = await render(<CoursesScreen />);
  const list = container.queryAll((n) => typeof n.props.onRefresh === 'function')[0];
  await fireEvent(list, 'refresh');
  expect(refresh).toHaveBeenCalled();
  expect(titles()).toEqual(['Biology', 'Algebra']);
});
