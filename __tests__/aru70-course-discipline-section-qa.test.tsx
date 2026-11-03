// QA ARU-70: gaps in aru70-course-discipline-section.test.tsx: the teacher clearing a mentor's course to "No
// discipline", an error cleared when the list is closed and reopened, a discipline created live while the list is
// open, a long name keeping the pencil on the card, the pencil matching the ARU-71 icon spec, and the Create course
// picker staying a full list with no pencil.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import NewCourseScreen from '@/app/courses/new';
import { EDIT_ICON } from '@/components/Disciplines';
import { colors } from '@/lib/theme';
import type { Course, Discipline } from '@/lib/types';

import { courseA, fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const d = (id: string, name: string, hidden = false): Discipline => ({ id, name, hidden, createdById: 'T', createdAt: '2026-11-01T10:00:00.000Z' });
const math = d('DM', 'Math');
const art = d('DA', 'Art');
const A: Course = { ...courseA, disciplineId: 'DM' }; // owned by mentor M
const pencil = () => screen.getByRole('button', { name: 'Change discipline' });
const radios = () => screen.queryAllByRole('radio').map((r) => r.props.accessibilityLabel);

let now = 0;
beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  jest.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
});
afterEach(() => jest.restoreAllMocks());

it('AC 2: the teacher clears a mentor\'s course to "No discipline" (null) and the section collapses', async () => {
  const store = fakeStore('T', { courses: [A], disciplines: [art, math] });
  setStore(store);
  await render(<CourseDetailScreen />);
  await fireEvent.press(pencil());
  await fireEvent.press(screen.getByRole('radio', { name: 'No discipline' }));
  await waitFor(() => expect(store.setCourseDiscipline).toHaveBeenCalledWith('A', null));
  await waitFor(() => expect(screen.queryAllByRole('radio')).toHaveLength(0));
});

it('AC 7 / AC 8: an error shown in the open list is gone after closing and reopening', async () => {
  const setCourseDiscipline = jest.fn(async () => {
    throw new Error('Network request failed');
  });
  setStore(fakeStore('T', { courses: [A], disciplines: [art, math], setCourseDiscipline }));
  await render(<CourseDetailScreen />);
  await fireEvent.press(pencil());
  await fireEvent.press(screen.getByRole('radio', { name: 'Art' }));
  expect(await screen.findByText('Network request failed')).toBeTruthy();
  await fireEvent.press(pencil()); // close
  expect(screen.queryByText('Network request failed')).toBeNull();
  await fireEvent.press(pencil()); // reopen
  expect(screen.queryByText('Network request failed')).toBeNull();
  expect(screen.getByRole('radio', { name: 'Math', checked: true })).toBeTruthy();
});

it('edge: a discipline created while the list is open appears in it and can be picked', async () => {
  const store = fakeStore('M', { courses: [A], disciplines: [math] });
  setStore(store);
  const view = await render(<CourseDetailScreen />);
  await fireEvent.press(pencil());
  expect(radios()).toEqual(['No discipline', 'Math']);
  const next = fakeStore('M', { courses: [A], disciplines: [art, math] });
  setStore(next);
  await view.rerender(<CourseDetailScreen />);
  expect(radios()).toEqual(['No discipline', 'Art', 'Math']);
  await fireEvent.press(screen.getByRole('radio', { name: 'Art' }));
  await waitFor(() => expect(next.setCourseDiscipline).toHaveBeenCalledWith('A', 'DA'));
});

it('AC 10: a long name in the collapsed view keeps the pencil next to it', async () => {
  const long = d('DL', 'Interdisciplinary '.repeat(8).trim());
  setStore(fakeStore('T', { courses: [{ ...A, disciplineId: 'DL' }], disciplines: [long] }));
  await render(<CourseDetailScreen />);
  const value = screen.getAllByText(long.name).find((n) => n.props.numberOfLines === 2);
  expect(value).toBeTruthy();
  expect(value?.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ flexShrink: 1 })]));
  expect(pencil()).toBeTruthy();
});

it('AC 5: the pencil is the shared edit icon in colors.primary, inside the 44×44 button', async () => {
  setStore(fakeStore('T', { courses: [A], disciplines: [math] }));
  await render(<CourseDetailScreen />);
  const icon = within(pencil()).getByTestId(`icon-${EDIT_ICON}`, { includeHiddenElements: true });
  expect(icon.props.color).toBe(colors.primary);
  expect(EDIT_ICON).toBe('create-outline');
});

it('out of scope: the Create course picker is still the full list, with no pencil', async () => {
  setStore(fakeStore('T', { disciplines: [art, math] }));
  await render(<NewCourseScreen />);
  expect(radios()).toEqual(['No discipline', 'Art', 'Math']);
  expect(screen.queryByRole('button', { name: 'Change discipline' })).toBeNull();
});
