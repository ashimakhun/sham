// QA ARU-63: gaps in aru63-disciplines.test.tsx: the rating always counts the reviews listed (a hidden course's
// feedback included for the teacher), "edited" and "Unknown" in the review list, the screen reader label on the
// Disciplines card, hidden courses with their badge in the teacher's discipline card, the teacher's New course picker
// with a hidden discipline, the picker's spoken value, a failed create keeping its input, long names, and an owner
// losing the picker live.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import NewCourseScreen from '@/app/courses/new';
import DisciplineScreen from '@/app/disciplines/[id]';
import NewDisciplineScreen from '@/app/disciplines/new';
import { CourseCard } from '@/components/CourseCard';
import type { Course, CourseFeedback, Discipline } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));

const d = (id: string, name: string, hidden = false): Discipline => ({ id, name, hidden, createdById: 'T', createdAt: '2026-11-01T10:00:00.000Z' });
const math = d('DM', 'Math');
const secret = d('DS', 'Secret', true);
const A: Course = { ...courseA, disciplineId: 'DM' };
const H: Course = { id: 'H', title: 'Hidden algebra', description: '', createdById: 'M', createdAt: '2026-10-05T10:00:00.000Z', hidden: true, disciplineId: 'DM' };
const fb = (id: string, courseId: string, rating: number, day: number, userId = 'S1', editedDay?: number): CourseFeedback => ({
  id,
  courseId,
  userId,
  rating,
  body: `Review ${id}`,
  createdAt: `2026-11-0${day}T10:00:00.000Z`,
  updatedAt: `2026-11-0${editedDay ?? day}T10:00:00.000Z`,
});

beforeEach(() => {
  jest.clearAllMocks();
  params.id = undefined;
});

describe('AC 9 / AC 10: the rating always counts the reviews listed', () => {
  it('teacher: a hidden course\'s feedback counts and is listed, with its course title', async () => {
    params.id = 'DM';
    setStore(fakeStore('T', { courses: [H, A], disciplines: [math], courseFeedback: [fb('f1', 'A', 5, 1), fb('f2', 'H', 2, 2)] }));
    await render(<DisciplineScreen />);
    expect(screen.getByText('★ 3.5 · 2 reviews')).toBeTruthy();
    expect(screen.getAllByTestId(/^review-/)).toHaveLength(2);
    expect(within(screen.getByTestId('review-f2')).getByText('Hidden algebra')).toBeTruthy();
  });

  it('a student who can\'t read the hidden course\'s feedback gets a rating over what they see', async () => {
    params.id = 'DM';
    // RLS (0025) returns no H rows to this student, so the store doesn't have them.
    setStore(fakeStore('S2', { courses: [A], disciplines: [math], courseFeedback: [fb('f1', 'A', 5, 1)] }));
    await render(<DisciplineScreen />);
    expect(screen.getByText('★ 5.0 · 1 review')).toBeTruthy();
    expect(screen.getAllByTestId(/^review-/)).toHaveLength(1);
  });

  it('feedback of a course in another discipline or none is not counted', async () => {
    params.id = 'DM';
    const other: Course = { ...courseA, id: 'O', title: 'Other', disciplineId: undefined };
    setStore(fakeStore('S1', { courses: [A, other], disciplines: [math], courseFeedback: [fb('f1', 'A', 4, 1), fb('f9', 'O', 1, 2)] }));
    await render(<DisciplineScreen />);
    expect(screen.getByText('★ 4.0 · 1 review')).toBeTruthy();
    expect(screen.queryByTestId('review-f9')).toBeNull();
  });

  it('an edited review shows "edited <date>", and a reviewer whose profile is gone shows "Unknown"', async () => {
    params.id = 'DM';
    setStore(fakeStore('S1', { courses: [A], disciplines: [math], courseFeedback: [fb('f1', 'A', 4, 1, 'GONE', 3)] }));
    await render(<DisciplineScreen />);
    const review = within(screen.getByTestId('review-f1'));
    expect(review.getByText('Unknown')).toBeTruthy();
    expect(review.getByText(/^edited /)).toBeTruthy();
    expect(review.getByLabelText(/4 (out of 5|stars?)/i)).toBeTruthy();
  });

  it('AC 9: the Disciplines card has the course cards\' screen reader label', async () => {
    setStore(fakeStore('S1', { courses: [A], courseMembers: [member('A', 'S1')], disciplines: [math], courseFeedback: [fb('f1', 'A', 5, 1), fb('f2', 'A', 2, 2, 'S3')] }));
    await render(<CoursesScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Disciplines' }));
    expect(screen.getByLabelText('Rated 3.5 out of 5, 2 reviews')).toBeTruthy();
  });
});

it('AC 11: the teacher\'s discipline card lists hidden courses with the Hidden badge', async () => {
  params.id = 'DM';
  setStore(fakeStore('T', { courses: [H, A], disciplines: [math] }));
  await render(<DisciplineScreen />);
  const list = within(screen.getByTestId('discipline-courses'));
  expect(list.getByText('Hidden algebra')).toBeTruthy();
  expect(list.getByText('Algebra')).toBeTruthy();
  expect(list.getAllByText('Hidden').length).toBeGreaterThanOrEqual(1);
});

describe('AC 4: New course picker', () => {
  it('the teacher sees a hidden discipline with its badge and can create a course in it', async () => {
    const store = fakeStore('T', { disciplines: [math, secret] });
    setStore(store);
    await render(<NewCourseScreen />);
    const radio = screen.getByRole('radio', { name: 'Secret' });
    expect(within(radio).getByText('Hidden')).toBeTruthy();
    await fireEvent.changeText(screen.getAllByDisplayValue('')[0], 'Topology');
    await fireEvent.press(radio);
    expect(screen.getByLabelText('Discipline, Secret')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Create/ }));
    await waitFor(() => expect(store.addCourse).toHaveBeenCalledWith(expect.objectContaining({ title: 'Topology', disciplineId: 'DS' })));
  });

  it('a mentor (who can\'t read hidden disciplines) only gets visible ones, "No discipline" first and checked', async () => {
    setStore(fakeStore('M', { disciplines: [math] }));
    await render(<NewCourseScreen />);
    const radios = screen.getAllByRole('radio').map((r) => [r.props.accessibilityLabel, r.props.accessibilityState?.checked]);
    expect(radios).toEqual([
      ['No discipline', true],
      ['Math', false],
    ]);
    expect(screen.getByLabelText('Discipline, No discipline')).toBeTruthy();
  });
});

it('AC 1 / edge offline: a failed create shows the error and keeps the name and the hidden switch', async () => {
  const addDiscipline = jest.fn(async () => {
    throw new Error('Network request failed');
  });
  setStore(fakeStore('T', { addDiscipline }));
  await render(<NewDisciplineScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('e.g. Mathematics'), 'Music');
  await fireEvent(screen.getByLabelText('Hidden discipline'), 'valueChange', true);
  await fireEvent.press(screen.getByRole('button', { name: 'Create discipline' }));
  expect(await screen.findByText('Network request failed')).toBeTruthy();
  expect(screen.getByDisplayValue('Music')).toBeTruthy();
  expect(screen.getByLabelText('Hidden discipline').props.value).toBe(true);
});

it('edge: a long discipline name wraps to two lines on the course card and the Disciplines card', async () => {
  const long = d('DL', 'Applied '.repeat(12).trim());
  const C: Course = { ...courseA, disciplineId: 'DL' };
  setStore(fakeStore('S1', { courses: [C], disciplines: [long] }));
  const card = await render(<CourseCard course={C} />);
  expect(screen.getByText(`Discipline: ${long.name}`).props.numberOfLines).toBe(2);
  expect(screen.getByLabelText(`Discipline, ${long.name}`)).toBeTruthy();
  await card.unmount();
  await render(<CoursesScreen />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Disciplines' }));
  expect(screen.getByText(long.name).props.numberOfLines).toBe(2);
});

it('edge ARU-9: an owner who loses the course loses the picker on the next update', async () => {
  params.id = 'A';
  setStore(fakeStore('M', { courses: [A], disciplines: [math] }));
  const view = await render(<CourseDetailScreen />);
  expect(screen.getByRole('radio', { name: 'Math', checked: true })).toBeTruthy();
  setStore(fakeStore('M', { courses: [{ ...A, createdById: 'N' }], disciplines: [math] }));
  await view.rerender(<CourseDetailScreen />);
  expect(screen.queryByRole('radio', { name: 'Math' })).toBeNull();
  expect(screen.getByText('Discipline: Math')).toBeTruthy();
});
