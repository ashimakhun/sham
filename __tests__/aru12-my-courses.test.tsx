// ARU-12: "My courses" on the Courses tab. No database change: it filters the store's courses and memberships.
// Users per the TEST DESIGN: M owns A and is a listener of B; N owns B and C; S in A and B; S2 and M2 in nothing;
// T owns nothing. ARU-63 renamed the view "Courses", replaced "All courses" with "Disciplines", and lists courses with
// no discipline after the user's own; these courses all have discipline D, so the ARU-12 sections are unchanged.
import { fireEvent, render, screen } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import type { Course, Discipline } from '@/lib/types';
import { router } from 'expo-router';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courseC: Course = { id: 'C', title: 'Chemistry', description: '', createdById: 'N', createdAt: '2026-10-03T10:00:00.000Z' };
const D: Discipline = { id: 'D', name: 'Sciences', hidden: false, createdById: 'T', createdAt: '2026-10-01T10:00:00.000Z' };
// Newest first, as the store provides them; all in discipline D (ARU-63).
const courses = [courseC, courseB, courseA].map((c) => ({ ...c, disciplineId: 'D' }));
const courseMembers = [member('A', 'S1'), member('B', 'S1'), member('B', 'M')];
const store = (who: Parameters<typeof fakeStore>[0]) => fakeStore(who, { courses, courseMembers, disciplines: [D] });

const tab = (name: string) => screen.getByRole('tab', { name });
const titles = () => screen.queryAllByText(/^(Algebra|Biology|Chemistry)$/).map((t) => t.props.children);
const headings = () => screen.queryAllByText(/^COURSES I/).map((t) => t.props.children);

beforeEach(() => jest.clearAllMocks());

describe('switch', () => {
  it.each(['S1', 'M', 'T'] as const)('AC1 (ARU-63): %s sees the switch with "Courses" selected', async (who) => {
    setStore(store(who));
    await render(<CoursesScreen />);
    expect(tab('Courses')).toBeSelected();
    expect(tab('Disciplines')).not.toBeSelected();
  });

  it('AC2 (ARU-63): courses with no discipline follow under "No discipline", newest first', async () => {
    const free = [courseC, courseB, courseA]; // no discipline
    setStore(fakeStore('S2', { courses: free, courseMembers }));
    await render(<CoursesScreen />);
    expect(screen.getByText('NO DISCIPLINE')).toBeTruthy();
    expect(titles()).toEqual(['Chemistry', 'Biology', 'Algebra']);
    setStore(fakeStore('N', { courses: free, courseMembers }));
    await render(<CoursesScreen />);
    expect(screen.getByRole('button', { name: '+ New course' })).toBeTruthy();
  });
});

describe('My courses', () => {
  it('AC3/AC6/AC13: a student sees only "Courses I\'m in", newest first (no Listener tag since ARU-81)', async () => {
    setStore(store('S1'));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(["COURSES I'M IN"]);
    expect(titles()).toEqual(['Biology', 'Algebra']);
    // ARU-81: the section heading says it; the cards carry no "Listener" / "Owner" tag.
    expect(screen.queryByText('Listener')).toBeNull();
    expect(screen.queryByText('Owner')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ New course' })).toBeNull();
  });

  it('AC4/AC13: an owner who attends nothing sees only "Courses I own" (no Owner tag since ARU-81)', async () => {
    setStore(store('N'));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(['COURSES I OWN']);
    expect(titles()).toEqual(['Chemistry', 'Biology']);
    expect(screen.queryByText('Owner')).toBeNull();
  });

  it('AC5: a mentor who owns A and attends B sees each once, in the right section', async () => {
    setStore(store('M'));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(["COURSES I'M IN", 'COURSES I OWN']);
    expect(titles()).toEqual(['Biology', 'Algebra']);
    // ARU-81: the sections place the courses; neither card has a tag.
    expect(screen.queryByText('Listener')).toBeNull();
    expect(screen.queryByText('Owner')).toBeNull();
  });

  it('AC7: tapping a course in "My courses" opens the same details screen', async () => {
    setStore(store('S1'));
    await render(<CoursesScreen />);
    await fireEvent.press(screen.getByText('Algebra'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });

  it('AC8/AC9: memberships from the store update the list (live updates refetch the store)', async () => {
    setStore(store('S2'));
    const { rerender } = await render(<CoursesScreen />);
    expect(titles()).toEqual([]);
    setStore(fakeStore('S2', { courses, courseMembers: [...courseMembers, member('C', 'S2')], disciplines: [D] }));
    await rerender(<CoursesScreen />);
    expect(titles()).toEqual(['Chemistry']);
    setStore(store('S2'));
    await rerender(<CoursesScreen />);
    expect(titles()).toEqual([]);
  });

  it('AC11: pull to refresh works on both views', async () => {
    const s = store('S1');
    setStore(s);
    const { container } = await render(<CoursesScreen />);
    const list = () => container.queryAll((n) => typeof n.props.onRefresh === 'function')[0];
    list().props.onRefresh();
    await fireEvent.press(tab('Disciplines'));
    list().props.onRefresh();
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });
});

describe('empty states (AC12)', () => {
  it('student', async () => {
    setStore(store('S2'));
    await render(<CoursesScreen />);
    expect(screen.getByText('You are not in any course yet')).toBeTruthy();
    expect(screen.getByText('Ask your teacher or mentor to add you.')).toBeTruthy();
  });

  it('mentor, with "+ New course" still above', async () => {
    setStore(store('M2'));
    await render(<CoursesScreen />);
    expect(screen.getByText("You don't own or attend any course yet")).toBeTruthy();
    expect(screen.getByText('Create one with "+ New course" or ask to be added.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ New course' })).toBeTruthy();
  });

  it('teacher', async () => {
    setStore(store('T'));
    await render(<CoursesScreen />);
    expect(screen.getByText("You don't own any course yet")).toBeTruthy();
    expect(screen.getByText('Create one with "+ New course".')).toBeTruthy();
  });
});
