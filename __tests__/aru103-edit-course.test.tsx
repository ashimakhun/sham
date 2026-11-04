// ARU-103: the pencil in the course name card opens the Edit course modal (Discipline + Owner); the separate Discipline
// card and the "Change owner" button are gone from course details. No database change: the server rules are covered by
// the ARU-9 and ARU-70 SQL tests.
// Teacher T; mentor M owns A (in Math); mentor N owns nothing here; S1 is a listener of A; S2 is in nothing.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import EditCourseScreen from '@/app/courses/[id]/edit';
import ChangeOwnerScreen from '@/app/courses/[id]/owner';
import { EDIT_ICON } from '@/components/Disciplines';
import { colors, formatDate } from '@/lib/theme';
import type { Course, Discipline } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const d = (id: string, name: string, hidden = false): Discipline => ({ id, name, hidden, createdById: 'T', createdAt: '2026-11-01T10:00:00.000Z' });
const math = d('DM', 'Math');
const art = d('DA', 'Art');
const A: Course = { ...courseA, disciplineId: 'DM' };
const members = [member('A', 'S1')];
const forRole = (who: 'T' | 'M' | 'N' | 'S1' | 'S2', over = {}) =>
  fakeStore(who, { courses: [A], courseMembers: members, disciplines: [art, math], ...over });

const pencil = () => screen.getByRole('button', { name: 'Edit course' });
const noPencil = () => expect(screen.queryByRole('button', { name: 'Edit course' })).toBeNull();

let now = 0;
beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  jest.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
});
afterEach(() => jest.restoreAllMocks());

describe('AC 1 / AC 2: the pencil in the course name card', () => {
  it.each(['T', 'M', 'N'] as const)('%s (teacher, mentor owner, mentor non-owner) sees it; it opens Edit course', async (who) => {
    setStore(forRole(who));
    await render(<CourseDetailScreen />);
    await fireEvent.press(pencil());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/edit', params: { id: 'A' } });
  });

  it.each(['S1', 'S2'] as const)('student %s (listener / summary view) has no pencil', async (who) => {
    setStore(forRole(who));
    await render(<CourseDetailScreen />);
    noPencil();
  });

  it('is the shared edit icon in colors.primary inside a 44×44 button', async () => {
    setStore(forRole('T'));
    await render(<CourseDetailScreen />);
    const btn = pencil();
    const style = StyleSheet.flatten(typeof btn.props.style === 'function' ? btn.props.style({ pressed: false }) : btn.props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
    expect(screen.getByTestId(`icon-${EDIT_ICON}`).props.color).toBe(colors.primary);
  });

  it('a hidden course keeps its Hidden badge next to the title, with the pencil on the same row', async () => {
    setStore(forRole('T', { courses: [{ ...A, hidden: true }] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(pencil()).toBeTruthy();
  });

  it('a long title can wrap (no line limit) and the pencil stays', async () => {
    const title = 'A very long course title '.repeat(6).trim();
    setStore(forRole('T', { courses: [{ ...A, title }] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText(title).props.numberOfLines).toBeUndefined();
    expect(pencil()).toBeTruthy();
  });
});

describe('AC 3: opening Edit course', () => {
  it('a double tap opens it only once', async () => {
    setStore(forRole('T'));
    await render(<CourseDetailScreen />);
    (Date.now as jest.Mock).mockImplementation(() => 5_000_000);
    await fireEvent.press(pencil());
    await fireEvent.press(pencil());
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('the teacher sees both sections', async () => {
    setStore(forRole('T'));
    await render(<EditCourseScreen />);
    expect(screen.getByLabelText('Discipline, Math')).toBeTruthy();
    expect(screen.getByLabelText('Owner, Mentor Max')).toBeTruthy();
  });
});

describe('AC 5 / AC 6: Owner section', () => {
  it('a mentor who does not own the course sees only the Owner section', async () => {
    setStore(forRole('N'));
    await render(<EditCourseScreen />);
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.getByText('Mentor Max')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change owner' })).toBeTruthy();
  });

  it('"Change owner" has a ">" arrow and opens the picker once on a double tap', async () => {
    setStore(forRole('T'));
    await render(<EditCourseScreen />);
    expect(screen.getByTestId('icon-chevron-forward')).toBeTruthy();
    (Date.now as jest.Mock).mockImplementation(() => 7_000_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Change owner' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Change owner' }));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/owner', params: { id: 'A' } });
  });

  it('an owner whose profile is missing shows "Unknown"', async () => {
    setStore(forRole('T', { courses: [{ ...A, createdById: 'gone' }] }));
    await render(<EditCourseScreen />);
    expect(screen.getByText('Unknown')).toBeTruthy();
  });

  it('picking a new owner goes back (to Edit course), which shows the new owner; a mentor owner loses the Discipline section', async () => {
    const store = forRole('M');
    setStore(store);
    const view = await render(<ChangeOwnerScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mentor Nina' }));
    await waitFor(() => expect(store.changeCourseOwner).toHaveBeenCalledWith('A', 'N'));
    expect(router.back).toHaveBeenCalled();
    setStore(forRole('M', { courses: [{ ...A, createdById: 'N' }] }));
    await view.rerender(<EditCourseScreen />);
    expect(screen.getByText('Mentor Nina')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toEqual([]);
  });
});

describe('AC 7 / AC 8: Course details', () => {
  it.each(['T', 'M', 'N', 'S1'] as const)(
    '%s: the live discipline label and owner line show; no Discipline card or Change owner button',
    async (who) => {
      setStore(forRole(who, { courses: [{ ...A, createdById: 'N', disciplineId: 'DA' }] }));
      await render(<CourseDetailScreen />);
      expect(screen.getByLabelText('Discipline, Art')).toBeTruthy();
      expect(screen.getByText(`Owner: Mentor Nina · ${formatDate(A.createdAt)}`)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Change owner' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Change discipline' })).toBeNull();
      expect(screen.queryAllByRole('radio')).toEqual([]);
    },
  );
});

describe('AC 9 and edge cases: guards', () => {
  it.each(['S1', 'S2'] as const)('student %s opening Edit course directly sees "Not allowed" and no controls', async (who) => {
    setStore(forRole(who));
    await render(<EditCourseScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Change owner' })).toBeNull();
  });

  it('a role change to student while open switches to "Not allowed"', async () => {
    setStore(forRole('T'));
    const view = await render(<EditCourseScreen />);
    expect(screen.getByRole('button', { name: 'Change owner' })).toBeTruthy();
    setStore(fakeStore('T', { currentUser: { id: 'T', name: 'Teacher Tess', role: 'student' }, courses: [A] }));
    await view.rerender(<EditCourseScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });

  it('a course deleted while open shows "Course not found"', async () => {
    setStore(forRole('T'));
    const view = await render(<EditCourseScreen />);
    setStore(forRole('T', { courses: [] }));
    await view.rerender(<EditCourseScreen />);
    expect(screen.getByText('Course not found')).toBeTruthy();
  });
});
