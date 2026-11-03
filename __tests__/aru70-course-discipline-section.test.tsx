// ARU-70: the teacher changes the discipline of any course; the section on course details is collapsed behind a
// pencil. Rules are tested in supabase/tests/aru70_teacher_sets_any_course_discipline.test.sql.
// Teacher T; mentor M owns A (in Math) and H (hidden course); mentor N owns B (in Secret, hidden) and C (none);
// S1 is a listener of A.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { canChangeCourseDiscipline, EDIT_ICON } from '@/components/Disciplines';
import { colors } from '@/lib/theme';
import type { Course, Discipline } from '@/lib/types';

import { courseA, courseB, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const d = (id: string, name: string, hidden = false): Discipline => ({ id, name, hidden, createdById: 'T', createdAt: '2026-11-01T10:00:00.000Z' });
const math = d('DM', 'Math');
const art = d('DA', 'Art');
const secret = d('DS', 'Secret', true);
const A: Course = { ...courseA, disciplineId: 'DM' };
const B: Course = { ...courseB, disciplineId: 'DS' };
const C: Course = { id: 'C', title: 'Chemistry', description: '', createdById: 'N', createdAt: '2026-10-03T10:00:00.000Z' };
const H: Course = { id: 'H', title: 'Hidden algebra', description: '', createdById: 'M', createdAt: '2026-10-05T10:00:00.000Z', hidden: true };
const courses = [A, B, C, H];
const members = [member('A', 'S1')];
// What each role reads: hidden disciplines only for the teacher (RLS).
const forRole = (who: 'T' | 'M' | 'N' | 'S1', over = {}) =>
  fakeStore(who, { courses, courseMembers: members, disciplines: who === 'T' ? [art, math, secret] : [art, math], ...over });

const pencil = () => screen.getByRole('button', { name: 'Change discipline' });
const radios = () => screen.queryAllByRole('radio').map((r) => [r.props.accessibilityLabel, !!r.props.accessibilityState?.checked]);

let now = 0;
beforeEach(() => {
  jest.clearAllMocks();
  // Time moves on between taps, so the pencil's double-tap guard only matters where a test freezes it.
  jest.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
});
afterEach(() => jest.restoreAllMocks());

describe('AC1 / AC11: who sees the section', () => {
  it.each(['A', 'B', 'C', 'H'])('the teacher sees it on course %s (own or not, hidden or not)', async (id) => {
    params.id = id;
    setStore(forRole('T'));
    await render(<CourseDetailScreen />);
    expect(pencil()).toBeTruthy();
  });

  it('a mentor sees it on their own course only; a student never', async () => {
    params.id = 'A';
    setStore(forRole('M'));
    const view = await render(<CourseDetailScreen />);
    expect(pencil()).toBeTruthy();
    setStore(forRole('N'));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Change discipline' })).toBeNull();
    expect(screen.getByText('Discipline: Math')).toBeTruthy();
    setStore(forRole('S1'));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Change discipline' })).toBeNull();
    expect(screen.getByText('Discipline: Math')).toBeTruthy();
  });

  it('edge ARU-9: a mentor who loses the course loses the section (open or not) on the next update', async () => {
    params.id = 'A';
    setStore(forRole('M'));
    const view = await render(<CourseDetailScreen />);
    await fireEvent.press(pencil());
    expect(screen.getByRole('radio', { name: 'Math', checked: true })).toBeTruthy();
    setStore(forRole('M', { courses: [{ ...A, createdById: 'N' }] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByRole('radio', { name: 'Math' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change discipline' })).toBeNull();
    expect(screen.getByText('Discipline: Math')).toBeTruthy();
  });

  it('canChangeCourseDiscipline: teacher any course, mentor own course, nobody else', () => {
    expect(canChangeCourseDiscipline(users.T, B)).toBe(true);
    expect(canChangeCourseDiscipline(users.M, A)).toBe(true);
    expect(canChangeCourseDiscipline(users.M, B)).toBe(false);
    expect(canChangeCourseDiscipline(users.S1, A)).toBe(false);
    expect(canChangeCourseDiscipline(null, A)).toBe(false);
  });

  it('edge: no disciplines and none set: no section; it appears once a discipline exists', async () => {
    params.id = 'C';
    setStore(forRole('T', { disciplines: [] }));
    const view = await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Change discipline' })).toBeNull();
    setStore(forRole('T', { disciplines: [math] }));
    await view.rerender(<CourseDetailScreen />);
    expect(pencil()).toBeTruthy();
  });

  it('edge: a mentor owner whose course has a discipline hidden from them keeps the section', async () => {
    params.id = 'B';
    setStore(forRole('N', { disciplines: [] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByLabelText('Discipline, Hidden discipline')).toBeTruthy();
    expect(pencil()).toBeTruthy();
  });
});

describe('AC5: collapsed by default', () => {
  it('shows the label, the value and the pencil in colors.primary; no options', async () => {
    params.id = 'A';
    setStore(forRole('M'));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Discipline')).toBeTruthy();
    expect(screen.getAllByText('Math').length).toBeGreaterThanOrEqual(1);
    expect(radios()).toEqual([]);
    const icon = screen.getByTestId(`icon-${EDIT_ICON}`);
    expect(icon.props.color).toBe(colors.primary);
  });

  it('"No discipline" when the course has none', async () => {
    params.id = 'C';
    setStore(forRole('T'));
    await render(<CourseDetailScreen />);
    expect(screen.getByLabelText('Discipline, No discipline')).toBeTruthy();
  });

  it('the teacher sees a hidden discipline\'s name with the Hidden badge', async () => {
    params.id = 'B';
    setStore(forRole('T'));
    await render(<CourseDetailScreen />);
    expect(screen.getAllByLabelText('Discipline, Secret').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Hidden').length).toBeGreaterThanOrEqual(1);
  });

  it('AC10: a long name wraps to two lines', async () => {
    const long = d('DL', 'Applied '.repeat(15).trim());
    params.id = 'A';
    setStore(forRole('T', { courses: [{ ...A, disciplineId: 'DL' }], disciplines: [long] }));
    await render(<CourseDetailScreen />);
    const texts = screen.getAllByText(long.name);
    expect(texts.every((t) => t.props.numberOfLines === 2)).toBe(true);
    expect(pencil()).toBeTruthy();
  });
});

describe('AC6–AC8: open, pick, cancel', () => {
  it('AC6: the pencil opens the full list with the current value checked (teacher: hidden ones too)', async () => {
    params.id = 'A';
    setStore(forRole('T'));
    await render(<CourseDetailScreen />);
    await fireEvent.press(pencil());
    expect(radios()).toEqual([
      ['No discipline', false],
      ['Art', false],
      ['Math', true],
      ['Secret', false],
    ]);
  });

  it('AC6: a mentor owner gets "Hidden discipline" second, then the visible ones', async () => {
    params.id = 'B';
    setStore(forRole('N'));
    await render(<CourseDetailScreen />);
    await fireEvent.press(pencil());
    expect(radios()).toEqual([
      ['No discipline', false],
      ['Hidden discipline', true],
      ['Art', false],
      ['Math', false],
    ]);
  });

  it('AC2 / AC3 / AC7: the teacher saves on a mentor\'s course (a hidden discipline too) and the section collapses', async () => {
    params.id = 'A';
    const store = forRole('T');
    setStore(store);
    await render(<CourseDetailScreen />);
    await fireEvent.press(pencil());
    await fireEvent.press(screen.getByRole('radio', { name: 'Secret' }));
    await waitFor(() => expect(store.setCourseDiscipline).toHaveBeenCalledWith('A', 'DS'));
    await waitFor(() => expect(radios()).toEqual([]));
    await fireEvent.press(pencil());
    await fireEvent.press(screen.getByRole('radio', { name: 'No discipline' }));
    await waitFor(() => expect(store.setCourseDiscipline).toHaveBeenLastCalledWith('A', null));
  });

  it('AC7: while saving, "Saving…" shows and the options and pencil are disabled; a double tap saves once', async () => {
    params.id = 'A';
    let finish: () => void = () => {};
    const setCourseDiscipline = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setStore(forRole('M', { setCourseDiscipline }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(pencil());
    const art1 = screen.getByRole('radio', { name: 'Art' });
    await fireEvent.press(art1);
    await fireEvent.press(art1);
    expect(setCourseDiscipline).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saving…')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Art' })).toBeDisabled();
    expect(pencil()).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(radios()).toEqual([]));
  });

  it('AC7: an error keeps the list open with the previous value checked and shows the message', async () => {
    params.id = 'A';
    const setCourseDiscipline = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    setStore(forRole('M', { setCourseDiscipline }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(pencil());
    await fireEvent.press(screen.getByRole('radio', { name: 'Art' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Math', checked: true })).toBeTruthy();
    // Closing the list drops the error.
    await fireEvent.press(pencil());
    expect(screen.queryByText('Network request failed')).toBeNull();
  });

  it('AC8: the current option or the pencil again collapses without saving', async () => {
    params.id = 'A';
    const store = forRole('M');
    setStore(store);
    await render(<CourseDetailScreen />);
    await fireEvent.press(pencil());
    await fireEvent.press(screen.getByRole('radio', { name: 'Math' }));
    expect(radios()).toEqual([]);
    await fireEvent.press(pencil());
    expect(radios().length).toBeGreaterThan(0);
    await fireEvent.press(pencil());
    expect(radios()).toEqual([]);
    expect(store.setCourseDiscipline).not.toHaveBeenCalled();
  });

  it('edge: a double tap on the pencil opens the list once', async () => {
    params.id = 'A';
    setStore(forRole('M'));
    await render(<CourseDetailScreen />);
    (Date.now as jest.Mock).mockImplementation(() => 5_000_000); // both taps at the same moment
    await fireEvent.press(pencil());
    await fireEvent.press(pencil());
    expect(radios().length).toBeGreaterThan(0);
  });
});

describe('AC9: accessibility', () => {
  it('the value is read as "Discipline, <value>"; the pencil is a 44×44 "Change discipline" button; radios keep their state', async () => {
    params.id = 'A';
    setStore(forRole('M'));
    await render(<CourseDetailScreen />);
    // The header card's label and the section's value (no third one).
    expect(screen.getAllByLabelText('Discipline, Math')).toHaveLength(2);
    const btn = pencil();
    const style = StyleSheet.flatten(typeof btn.props.style === 'function' ? btn.props.style({ pressed: false }) : btn.props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
    expect(btn.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(btn);
    expect(pencil().props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByRole('radio', { name: 'Math', checked: true })).toBeTruthy();
  });
});
