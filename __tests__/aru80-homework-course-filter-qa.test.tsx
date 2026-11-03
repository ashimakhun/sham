// QA ARU-80: gaps in aru80-homework-course-filter.test.tsx: a course chosen on Checked doesn't narrow To check /
// Waiting / New (AC 4), each option's screen reader label and selected state (AC 10), a long course title in the
// button stays on one line (edge), and course details no longer offers any homework for any role (AC 1).
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import CourseDetailScreen from '@/app/courses/[id]';
import type { Course, Homework } from '@/lib/types';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const longB: Course = { ...courseB, title: 'Biology for advanced listeners who want a very long course title '.repeat(2).trim() };
const HOMEWORK: Homework[] = [
  hw({ id: 'a1', courseId: 'A', studentId: 'S1', title: 'HW A1 checked', status: 'checked', checkedById: 'M' }),
  hw({ id: 'b1', courseId: 'B', studentId: 'S1', title: 'HW B1 checked', status: 'checked', checkedById: 'M' }),
  hw({ id: 'a2', courseId: 'A', studentId: 'S2', title: 'HW A2 waiting' }),
  hw({ id: 'b2', courseId: 'B', studentId: 'S2', title: 'HW B2 waiting' }),
];
const members = [member('A', 'S1'), member('B', 'S1'), member('A', 'S2'), member('B', 'S2')];
const filterButton = () => screen.queryByRole('button', { name: /^Filter by course, / });
const listButtons = () => within(screen.getByTestId('course-filter-list')).getAllByRole('button');
const titles = () => screen.queryAllByText(/^HW /).map((t) => t.props.children);

beforeEach(() => jest.clearAllMocks());

it('AC 4: a course chosen on Checked doesn\'t narrow To check; coming back to Checked keeps the choice', async () => {
  setStore(fakeStore('T', { courses: [courseA, longB], courseMembers: members, visibleHomework: HOMEWORK }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Checked'));
  await fireEvent.press(filterButton()!);
  await fireEvent.press(listButtons()[1]); // Algebra
  expect(titles()).toEqual(['HW A1 checked']);
  await fireEvent.press(screen.getByText(/^To check/));
  expect(filterButton()).toBeNull();
  expect(titles()).toEqual(['HW A2 waiting', 'HW B2 waiting']);
  await fireEvent.press(screen.getByText('Checked'));
  expect(filterButton()!.props.accessibilityLabel).toBe('Filter by course, Algebra');
});

it('AC 10: each option is read with its course title and whether it is selected', async () => {
  setStore(fakeStore('S1', { courses: [courseA, longB], courseMembers: members, visibleHomework: HOMEWORK.filter((h) => h.studentId === 'S1') }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Checked'));
  expect(filterButton()!.props.accessibilityHint).toBe('Opens the list of courses');
  await fireEvent.press(filterButton()!);
  const opts = listButtons().map((b) => [b.props.accessibilityLabel, !!b.props.accessibilityState?.selected]);
  expect(opts).toEqual([
    ['All courses', true],
    ['Algebra', false],
    [longB.title, false],
  ]);
});

it('edge: a long course title in the button stays on one line with an ellipsis', async () => {
  setStore(fakeStore('S1', { courses: [courseA, longB], courseMembers: members, visibleHomework: HOMEWORK.filter((h) => h.studentId === 'S1') }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Checked'));
  await fireEvent.press(filterButton()!);
  await fireEvent.press(listButtons()[2]);
  expect(titles()).toEqual(['HW B1 checked']);
  const text = within(filterButton()!).getByText(new RegExp(longB.title.slice(0, 20)));
  expect(text.props.numberOfLines).toBe(1);
  expect(text.props.ellipsizeMode).toBe('tail');
});

it.each(['S1', 'S2', 'M', 'T'] as const)('AC 1: %s sees no homework titles on course details', async (who) => {
  params.id = 'A';
  setStore(fakeStore(who, { courses: [courseA, longB], courseMembers: members, visibleHomework: HOMEWORK }));
  await render(<CourseDetailScreen />);
  expect(titles()).toEqual([]);
  expect(screen.queryByText('HOMEWORK')).toBeNull();
  expect(screen.queryByText('No homework for this course yet')).toBeNull();
});

it('AC 7: after falling back to All courses, the old course coming back doesn\'t silently re-apply the filter', async () => {
  const mine = HOMEWORK.filter((h) => h.studentId === 'S1');
  setStore(fakeStore('S1', { courses: [courseA, longB], courseMembers: members, visibleHomework: mine }));
  const view = await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Checked'));
  await fireEvent.press(filterButton()!);
  await fireEvent.press(listButtons()[1]); // Algebra
  setStore(fakeStore('S1', { courses: [courseA, longB], courseMembers: members, visibleHomework: mine.filter((h) => h.id !== 'a1') }));
  await view.rerender(<HomeworkScreen />);
  expect(filterButton()!.props.accessibilityLabel).toBe('Filter by course, All courses');
  setStore(fakeStore('S1', { courses: [courseA, longB], courseMembers: members, visibleHomework: mine }));
  await view.rerender(<HomeworkScreen />);
  expect(filterButton()!.props.accessibilityLabel).toBe('Filter by course, All courses');
  expect(titles()).toEqual(['HW A1 checked', 'HW B1 checked']);
});
