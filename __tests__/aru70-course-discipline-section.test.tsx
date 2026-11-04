// ARU-70: the teacher changes the discipline of any course. ARU-103 moved the section from course details (collapsed
// behind a pencil) to the Edit course modal, where the list is always shown. Rules are tested in supabase/tests/aru70_teacher_sets_any_course_discipline.test.sql.
// Teacher T; mentor M owns A (in Math) and H (hidden course); mentor N owns B (in Secret, hidden) and C (none);
// S1 is a listener of A.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import EditCourseScreen from '@/app/courses/[id]/edit';
import { canChangeCourseDiscipline } from '@/components/Disciplines';
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

const radios = () => screen.queryAllByRole('radio').map((r) => [r.props.accessibilityLabel, !!r.props.accessibilityState?.checked]);
const hasSection = () => screen.queryAllByRole('radio').length > 0;

beforeEach(() => jest.clearAllMocks());

describe('AC1 / AC11: who sees the section', () => {
  it.each(['A', 'B', 'C', 'H'])('the teacher sees it on course %s (own or not, hidden or not)', async (id) => {
    params.id = id;
    setStore(forRole('T'));
    await render(<EditCourseScreen />);
    expect(hasSection()).toBe(true);
  });

  it('a mentor sees it on their own course only; a student is not allowed', async () => {
    params.id = 'A';
    setStore(forRole('M'));
    const view = await render(<EditCourseScreen />);
    expect(hasSection()).toBe(true);
    setStore(forRole('N'));
    await view.rerender(<EditCourseScreen />);
    expect(hasSection()).toBe(false);
    expect(screen.getByText('Change owner')).toBeTruthy();
    setStore(forRole('S1'));
    await view.rerender(<EditCourseScreen />);
    expect(hasSection()).toBe(false);
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });

  it('edge ARU-9: a mentor who loses the course loses the section on the next update', async () => {
    params.id = 'A';
    setStore(forRole('M'));
    const view = await render(<EditCourseScreen />);
    expect(screen.getByRole('radio', { name: 'Math', checked: true })).toBeTruthy();
    setStore(forRole('M', { courses: [{ ...A, createdById: 'N' }] }));
    await view.rerender(<EditCourseScreen />);
    expect(hasSection()).toBe(false);
    expect(screen.getByText('Mentor Nina')).toBeTruthy();
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
    const view = await render(<EditCourseScreen />);
    expect(hasSection()).toBe(false);
    setStore(forRole('T', { disciplines: [math] }));
    await view.rerender(<EditCourseScreen />);
    expect(hasSection()).toBe(true);
  });

  it('edge: a mentor owner whose course has a discipline hidden from them keeps the section', async () => {
    params.id = 'B';
    setStore(forRole('N', { disciplines: [] }));
    await render(<EditCourseScreen />);
    expect(screen.getByLabelText('Discipline, Hidden discipline')).toBeTruthy();
    expect(hasSection()).toBe(true);
  });

  it('ARU-103 AC 8: course details has no discipline section any more; the label stays', async () => {
    params.id = 'A';
    setStore(forRole('T'));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Change discipline' })).toBeNull();
    expect(radios()).toEqual([]);
    expect(screen.getByText('Discipline: Math')).toBeTruthy();
  });
});

describe('the current value', () => {
  it('"No discipline" when the course has none', async () => {
    params.id = 'C';
    setStore(forRole('T'));
    await render(<EditCourseScreen />);
    expect(screen.getByLabelText('Discipline, No discipline')).toBeTruthy();
  });

  it('the teacher sees a hidden discipline\'s name with the Hidden badge', async () => {
    params.id = 'B';
    setStore(forRole('T'));
    await render(<EditCourseScreen />);
    expect(screen.getByLabelText('Discipline, Secret')).toBeTruthy();
    expect(screen.getAllByText('Hidden').length).toBeGreaterThanOrEqual(1);
  });

  it('AC10: a long name wraps to two lines', async () => {
    const long = d('DL', 'Applied '.repeat(15).trim());
    params.id = 'A';
    setStore(forRole('T', { courses: [{ ...A, disciplineId: 'DL' }], disciplines: [long] }));
    await render(<EditCourseScreen />);
    expect(screen.getAllByText(long.name).some((t) => t.props.numberOfLines === 2)).toBe(true);
  });
});

describe('AC6–AC8: options and saving', () => {
  it('AC6: the full list with the current value checked (teacher: hidden ones too)', async () => {
    params.id = 'A';
    setStore(forRole('T'));
    await render(<EditCourseScreen />);
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
    await render(<EditCourseScreen />);
    expect(radios()).toEqual([
      ['No discipline', false],
      ['Hidden discipline', true],
      ['Art', false],
      ['Math', false],
    ]);
  });

  it('AC2 / AC3 / AC7: the teacher saves on a mentor\'s course (a hidden discipline too)', async () => {
    params.id = 'A';
    const store = forRole('T');
    setStore(store);
    await render(<EditCourseScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Secret' }));
    await waitFor(() => expect(store.setCourseDiscipline).toHaveBeenCalledWith('A', 'DS'));
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
    await fireEvent.press(screen.getByRole('radio', { name: 'No discipline' }));
    await waitFor(() => expect(store.setCourseDiscipline).toHaveBeenLastCalledWith('A', null));
  });

  it('AC7: while saving, "Saving…" shows and the options are disabled; a double tap saves once', async () => {
    params.id = 'A';
    let finish: () => void = () => {};
    const setCourseDiscipline = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setStore(forRole('M', { setCourseDiscipline }));
    await render(<EditCourseScreen />);
    const art1 = screen.getByRole('radio', { name: 'Art' });
    await fireEvent.press(art1);
    await fireEvent.press(art1);
    expect(setCourseDiscipline).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saving…')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Art' })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
  });

  it('AC7: an error keeps the previous value checked and shows the message', async () => {
    params.id = 'A';
    const setCourseDiscipline = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    setStore(forRole('M', { setCourseDiscipline }));
    await render(<EditCourseScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Art' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Math', checked: true })).toBeTruthy();
  });

  it('AC8: the current option saves nothing', async () => {
    params.id = 'A';
    const store = forRole('M');
    setStore(store);
    await render(<EditCourseScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Math' }));
    expect(store.setCourseDiscipline).not.toHaveBeenCalled();
  });
});
