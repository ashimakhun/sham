// QA ARU-81: gaps in aru81-no-card-tag.test.tsx: discipline details and the Disciplines view show no tag either
// (AC 6), and switching between the Courses and Disciplines views never brings a tag back.
import { fireEvent, render, screen } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import DisciplineScreen from '@/app/disciplines/[id]';
import type { Course, Discipline } from '@/lib/types';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const D: Discipline = { id: 'D', name: 'Sciences', hidden: false, createdById: 'T', createdAt: '2026-10-01T10:00:00.000Z' };
const A: Course = { ...courseA, disciplineId: 'D' };
const B: Course = { ...courseB, disciplineId: 'D' };
const noTags = () => {
  expect(screen.queryByText('Listener', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByText('Owner', { includeHiddenElements: true })).toBeNull();
};

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'D';
});

it('AC 6: discipline details cards (the teacher\'s course list there) have no tag', async () => {
  setStore(fakeStore('T', { courses: [A, { ...B, createdById: 'T' }], disciplines: [D], courseMembers: [member('B', 'M')] }));
  await render(<DisciplineScreen />);
  expect(screen.getAllByText(/^(Algebra|Biology)$/).length).toBeGreaterThanOrEqual(2);
  noTags();
});

it('AC 3: switching Courses → Disciplines → Courses never shows a tag', async () => {
  setStore(
    fakeStore('M', {
      courses: [{ ...courseA }, { ...courseB, disciplineId: 'D' }],
      disciplines: [D],
      courseMembers: [member('B', 'M')],
    }),
  );
  await render(<CoursesScreen />);
  noTags();
  await fireEvent.press(screen.getByRole('tab', { name: 'Disciplines' }));
  noTags();
  await fireEvent.press(screen.getByRole('tab', { name: 'Courses' }));
  expect(screen.getByText("COURSES I'M IN")).toBeTruthy();
  expect(screen.getByText('COURSES I OWN')).toBeTruthy();
  noTags();
});
