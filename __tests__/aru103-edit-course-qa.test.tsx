// QA ARU-103: gaps in aru103-edit-course.test.tsx: tapping the current discipline saves nothing (AC 4); "Saving…" shows
// and the options are disabled while a save runs (AC 4); a hidden discipline shows with its Hidden badge for the mentor
// owner (edge case); no disciplines and none set means no Discipline section for the teacher either (AC 5); the
// teacher gets the pencil on a hidden course they don't own (AC 1 edge); the summary view for a student outside the
// course has no pencil (AC 2); Delete course (ARU-85) stays on course details for the teacher.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import EditCourseScreen from '@/app/courses/[id]/edit';
import type { Course, Discipline } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const d = (id: string, name: string, hidden = false): Discipline => ({ id, name, hidden, createdById: 'T', createdAt: '2026-11-01T10:00:00.000Z' });
const math = d('DM', 'Math');
const art = d('DA', 'Art');
const secret = d('DS', 'Secret', true);
const A: Course = { ...courseA, disciplineId: 'DM' }; // owned by mentor M
const members = [member('A', 'S1')];

let now = 0;
beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  jest.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
});
afterEach(() => jest.restoreAllMocks());

it('AC 4: tapping the current discipline saves nothing', async () => {
  const store = fakeStore('T', { courses: [A], courseMembers: members, disciplines: [art, math] });
  setStore(store);
  await render(<EditCourseScreen />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Math', checked: true }));
  await act(async () => {});
  expect(store.setCourseDiscipline).not.toHaveBeenCalled();
});

it('AC 4: while a save runs, "Saving…" shows and the options are disabled; then it goes', async () => {
  const resolvers: (() => void)[] = [];
  const setCourseDiscipline = jest.fn(() => new Promise<void>((r) => resolvers.push(r)));
  setStore(fakeStore('T', { courses: [A], courseMembers: members, disciplines: [art, math], setCourseDiscipline }));
  await render(<EditCourseScreen />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Art' }));
  expect(await screen.findByText('Saving…')).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'No discipline' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('radio', { name: 'No discipline' }));
  expect(setCourseDiscipline).toHaveBeenCalledTimes(1);
  await act(async () => resolvers.forEach((r) => r()));
  await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
});

it('edge: a hidden discipline shows with its Hidden badge in the Discipline section for the mentor owner', async () => {
  setStore(fakeStore('M', { courses: [{ ...A, disciplineId: 'DS' }], courseMembers: members, disciplines: [math, secret] }));
  await render(<EditCourseScreen />);
  expect(screen.getByLabelText('Discipline, Secret')).toBeTruthy();
  expect(screen.getAllByText('Hidden').length).toBeGreaterThanOrEqual(1);
});

it('AC 5: no disciplines and none set: the teacher sees only the Owner section', async () => {
  setStore(fakeStore('T', { courses: [{ ...A, disciplineId: undefined }], courseMembers: members, disciplines: [] }));
  await render(<EditCourseScreen />);
  expect(screen.queryAllByRole('radio')).toEqual([]);
  expect(screen.queryByText('Discipline')).toBeNull();
  expect(screen.getByRole('button', { name: 'Change owner' })).toBeTruthy();
});

it('AC 1: the teacher gets the pencil on a hidden course they don\'t own, next to the Hidden badge', async () => {
  setStore(fakeStore('T', { courses: [{ ...A, hidden: true }], courseMembers: members, disciplines: [math] }));
  await render(<CourseDetailScreen />);
  expect(screen.getByRole('button', { name: 'Edit course' })).toBeTruthy();
  expect(screen.getAllByText('Hidden').length).toBeGreaterThanOrEqual(1);
});

it('AC 2: a student outside the course (summary view) has no pencil', async () => {
  setStore(fakeStore('S2', { courses: [A], courseMembers: members, disciplines: [math] }));
  await render(<CourseDetailScreen />);
  expect(screen.queryByRole('button', { name: 'Edit course' })).toBeNull();
});

it('regression ARU-85: Delete course stays on course details for the teacher; Change owner is gone from there', async () => {
  setStore(fakeStore('T', { courses: [A], courseMembers: members, disciplines: [math] }));
  await render(<CourseDetailScreen />);
  expect(screen.getByRole('button', { name: /^Delete course/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Change owner' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Change discipline' })).toBeNull();
});
