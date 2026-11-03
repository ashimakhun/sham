// ARU-12 QA: cases from the TEST DESIGN that aru12-my-courses.test.tsx does not cover yet —
// re-selecting "My courses" on focus, other users' memberships, owner changes, failed refresh.
// Updated for ARU-63: "My courses" / "All courses" became "Courses" / "Disciplines" (AC 7), and the Courses view also
// lists other courses that have no discipline under "No discipline" (AC 8). Chemistry is in a discipline here, so it
// is still "someone else's course I can't see in my list", as before.
import { fireEvent, render, screen } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import type { Course, Discipline } from '@/lib/types';
import { router } from 'expo-router';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const science: Discipline = { id: 'D1', name: 'Science', hidden: false, createdById: 'T', createdAt: '2026-10-01T10:00:00.000Z' };
const courseC: Course = {
  id: 'C',
  title: 'Chemistry',
  description: '',
  createdById: 'N',
  createdAt: '2026-10-03T10:00:00.000Z',
  disciplineId: 'D1',
};
const courses = [courseC, courseB, courseA];
// S1 in A and B; M (owner of A) in B.
const courseMembers = [member('A', 'S1'), member('B', 'S1'), member('B', 'M')];
const store = (who: Parameters<typeof fakeStore>[0], over = {}) =>
  fakeStore(who, { courses, courseMembers, disciplines: [science], ...over });

const tab = (name: string) => screen.getByRole('tab', { name });
const titles = () => screen.queryAllByText(/^(Algebra|Biology|Chemistry)$/).map((t) => t.props.children);
const headings = () => screen.queryAllByText(/^(COURSES I|NO DISCIPLINE)/).map((t) => t.props.children);

beforeEach(() => jest.clearAllMocks());

describe('AC1 (ARU-63 AC 7): "Courses" is selected each time the tab is opened', () => {
  it('re-entering the tab after "Disciplines" selects "Courses" again', async () => {
    setStore(store('S1'));
    await render(<CoursesScreen />);
    await fireEvent.press(tab('Disciplines'));
    expect(tab('Disciplines')).toBeSelected();
    await refocus(); // switch to another tab and back
    expect(tab('Courses')).toBeSelected();
    expect(titles()).toEqual(['Biology', 'Algebra']);
  });

  it('coming back from a discipline opened in "Disciplines" keeps "Disciplines"', async () => {
    setStore(store('S1'));
    await render(<CoursesScreen />);
    await fireEvent.press(tab('Disciplines'));
    await fireEvent.press(screen.getByText('Science'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/disciplines/[id]', params: { id: 'D1' } });
    await refocus(); // back from the discipline card
    expect(tab('Disciplines')).toBeSelected();
    await refocus(); // later: another tab and back
    expect(tab('Courses')).toBeSelected();
  });

  it('coming back from "+ New course" or "+ New discipline" keeps the current view', async () => {
    setStore(store('T'));
    await render(<CoursesScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '+ New course' }));
    expect(router.push).toHaveBeenCalledWith('/courses/new');
    await refocus();
    expect(tab('Courses')).toBeSelected();
    await fireEvent.press(tab('Disciplines'));
    await fireEvent.press(screen.getByRole('button', { name: '+ New discipline' }));
    expect(router.push).toHaveBeenCalledWith('/disciplines/new');
    await refocus();
    expect(tab('Disciplines')).toBeSelected();
  });
});

describe('access: only my own memberships count', () => {
  it('AC6: a mentor who can read every membership row sees none of other people\'s courses as theirs', async () => {
    setStore(store('M2'));
    await render(<CoursesScreen />);
    // Not owner or listener of anything: only the courses with no discipline, untagged; Chemistry (in a discipline) is out.
    expect(headings()).toEqual(['NO DISCIPLINE']);
    expect(titles()).toEqual(['Biology', 'Algebra']);
    expect(screen.queryByText('Owner')).toBeNull();
    expect(screen.queryByText('Listener')).toBeNull();
  });

  it('AC6: with every other course in a discipline, that mentor gets today\'s empty state', async () => {
    setStore(store('M2', { courses: courses.map((c) => ({ ...c, disciplineId: 'D1' })) }));
    await render(<CoursesScreen />);
    expect(titles()).toEqual([]);
    expect(screen.getByText("You don't own or attend any course yet")).toBeTruthy();
  });

  it('AC4/AC6: a student listener of A and B never gets a "Courses I own" section, and C stays out', async () => {
    setStore(store('S1'));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(["COURSES I'M IN"]);
    expect(titles()).not.toContain('Chemistry');
  });

  it('ARU-63 AC 8: the same course without a discipline is listed for that student under "No discipline"', async () => {
    setStore(store('S1', { courses: [{ ...courseC, disciplineId: undefined }, courseB, courseA] }));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(["COURSES I'M IN", 'NO DISCIPLINE']);
    expect(titles()).toEqual(['Biology', 'Algebra', 'Chemistry']);
  });

  it('roles: the teacher only has "Courses I own"', async () => {
    setStore(store('T', { courses: [{ ...courseC, id: 'D', title: 'Algebra', createdById: 'T' }] }));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(['COURSES I OWN']);
    // ARU-81: the section heading says it; cards have no "Owner" tag.
    expect(screen.queryByText('Owner')).toBeNull();
  });

  it('AC5: owning wins if bad data ever lists the owner as a listener too (no duplicates)', async () => {
    setStore(store('M', { courseMembers: [...courseMembers, member('A', 'M')] }));
    await render(<CoursesScreen />);
    expect(titles()).toEqual(['Biology', 'Algebra']);
    // ARU-81: no tags; A is listed once, under "Courses I own" (the second section).
    expect(headings()).toEqual(["COURSES I'M IN", 'COURSES I OWN']);
    expect(screen.getAllByText('Algebra')).toHaveLength(1);
    expect(screen.queryByText('Owner')).toBeNull();
    expect(screen.queryByText('Listener')).toBeNull();
  });
});

it('AC10: when the owner changes, the course moves between owners\' "Courses I own"', async () => {
  setStore(store('M2'));
  const { rerender } = await render(<CoursesScreen />);
  expect(titles()).not.toContain('Chemistry');
  const moved = [{ ...courseC, createdById: 'M2' }, courseB, courseA];
  setStore(store('M2', { courses: moved }));
  await rerender(<CoursesScreen />);
  expect(headings()).toEqual(['COURSES I OWN', 'NO DISCIPLINE']);
  expect(titles()).toEqual(['Chemistry', 'Biology', 'Algebra']);
  expect(screen.queryByText('Owner')).toBeNull(); // ARU-81: no tag on the card
  // N (owner of Biology) no longer owns Chemistry, which is in a discipline, so it leaves N's list entirely.
  setStore(store('N', { courses: moved }));
  await rerender(<CoursesScreen />);
  expect(headings()).toEqual(['COURSES I OWN', 'NO DISCIPLINE']);
  expect(titles()).toEqual(['Biology', 'Algebra']);
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
