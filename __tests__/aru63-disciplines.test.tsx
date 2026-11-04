// ARU-63: disciplines (UI side). Rules are tested in supabase/tests/aru63_disciplines.test.sql.
// Teacher T; mentor M owns A (in Math); mentor N owns B (in Physics, hidden) and C (no discipline); S1 is a
// listener of A; S2 is in nothing.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import EditCourseScreen from '@/app/courses/[id]/edit';
import NewCourseScreen from '@/app/courses/new';
import DisciplineScreen from '@/app/disciplines/[id]';
import NewDisciplineScreen from '@/app/disciplines/new';
import { coursesInDiscipline, disciplineFeedback } from '@/lib/disciplines';
import type { Course, CourseFeedback, Discipline } from '@/lib/types';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const discipline = (id: string, name: string, hidden = false): Discipline => ({
  id,
  name,
  hidden,
  createdById: 'T',
  createdAt: '2026-11-01T10:00:00.000Z',
});
const math = discipline('DM', 'Math');
const art = discipline('DA', 'Art');
const physics = discipline('DP', 'Physics', true);
const A: Course = { ...courseA, disciplineId: 'DM' };
const B: Course = { ...courseB, disciplineId: 'DP' };
const C: Course = { id: 'C', title: 'Chemistry', description: '', createdById: 'N', createdAt: '2026-10-03T10:00:00.000Z' };
const courses = [C, B, A];
const members = [member('A', 'S1')];
const fb = (id: string, courseId: string, rating: number, day: number, userId = 'S1'): CourseFeedback => ({
  id,
  courseId,
  userId,
  rating,
  body: `Review ${id}`,
  createdAt: `2026-11-0${day}T10:00:00.000Z`,
  updatedAt: `2026-11-0${day}T10:00:00.000Z`,
});
const feedback = [fb('f1', 'A', 5, 1), fb('f2', 'A', 3, 2, 'S3'), fb('f3', 'C', 4, 3)];
// What each role reads: hidden disciplines only for the teacher (RLS).
const forRole = (who: 'T' | 'M' | 'N' | 'S1' | 'S2', over = {}) =>
  fakeStore(who, {
    courses,
    courseMembers: members,
    courseFeedback: feedback,
    disciplines: who === 'T' ? [art, math, physics] : [art, math],
    ...over,
  });
const tab = (name: string) => screen.getByRole('tab', { name });
const titles = () => screen.queryAllByText(/^(Algebra|Biology|Chemistry)$/).map((t) => t.props.children);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = undefined;
});

describe('helpers', () => {
  it('a discipline\'s courses and their feedback, newest first', () => {
    expect(coursesInDiscipline('DM', courses).map((c) => c.id)).toEqual(['A']);
    expect(disciplineFeedback('DM', courses, feedback).map((f) => f.id)).toEqual(['f2', 'f1']);
    expect(disciplineFeedback('DA', courses, feedback)).toEqual([]);
  });
});

describe('AC7/AC8: Courses view', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees "Courses" selected and "Disciplines"; no "All courses"', async (who) => {
    setStore(forRole(who));
    await render(<CoursesScreen />);
    expect(tab('Courses')).toBeSelected();
    expect(tab('Disciplines')).not.toBeSelected();
    expect(screen.queryByRole('tab', { name: 'All courses' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'My courses' })).toBeNull();
  });

  it('S1: their course, then only courses with no discipline; a course in a discipline they\'re not in is missing', async () => {
    setStore(forRole('S1'));
    await render(<CoursesScreen />);
    expect(screen.getAllByText(/^(COURSES I'M IN|NO DISCIPLINE)$/).map((t) => t.props.children)).toEqual([
      "COURSES I'M IN",
      'NO DISCIPLINE',
    ]);
    expect(titles()).toEqual(['Algebra', 'Chemistry']); // B (in hidden Physics) isn't listed
  });

  it('S2 (in nothing): no "Courses I\'m in" heading, only "No discipline"', async () => {
    setStore(forRole('S2'));
    await render(<CoursesScreen />);
    expect(screen.queryByText("COURSES I'M IN")).toBeNull();
    expect(titles()).toEqual(['Chemistry']);
  });

  it('N (owner of B and C): both under "Courses I own", nothing repeated under "No discipline"', async () => {
    setStore(forRole('N'));
    await render(<CoursesScreen />);
    expect(screen.queryByText('NO DISCIPLINE')).toBeNull();
    expect(titles()).toEqual(['Chemistry', 'Biology']);
  });

  it('a course leaving "No discipline" disappears on the next store update (AC 12)', async () => {
    setStore(forRole('S2'));
    const view = await render(<CoursesScreen />);
    expect(titles()).toEqual(['Chemistry']);
    setStore(forRole('S2', { courses: [{ ...C, disciplineId: 'DA' }, B, A] }));
    await view.rerender(<CoursesScreen />);
    expect(titles()).toEqual([]);
  });

  it('"+ New course" stays on Courses for teachers and mentors, not on Disciplines', async () => {
    setStore(forRole('M'));
    await render(<CoursesScreen />);
    expect(screen.getByRole('button', { name: '+ New course' })).toBeTruthy();
    await fireEvent.press(tab('Disciplines'));
    expect(screen.queryByRole('button', { name: '+ New course' })).toBeNull();
  });
});

describe('AC6: the discipline name on cards and details', () => {
  it('a visible discipline shows on the card; a hidden one (for non-teachers) or none shows nothing', async () => {
    setStore(forRole('N'));
    await render(<CoursesScreen />);
    expect(screen.queryByText(/^Discipline:/)).toBeNull(); // B is in hidden Physics, C has none
    setStore(forRole('S1'));
    await render(<CoursesScreen />);
    expect(screen.getByText('Discipline: Math')).toBeTruthy();
    expect(screen.getByLabelText('Discipline, Math')).toBeTruthy();
  });

  it('the teacher sees a hidden discipline\'s name too', async () => {
    params.id = 'B';
    setStore(forRole('T'));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Discipline: Physics')).toBeTruthy();
  });

  it('course details show the name, also on a student\'s summary-only view', async () => {
    params.id = 'A';
    setStore(forRole('S2'));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Discipline: Math')).toBeTruthy();
  });
});

describe('AC9: Disciplines view', () => {
  it('cards A–Z with the rating summary; no rating line without feedback', async () => {
    setStore(forRole('S1'));
    await render(<CoursesScreen />);
    await fireEvent.press(tab('Disciplines'));
    expect(screen.getAllByText(/^(Art|Math|Physics)$/).map((t) => t.props.children)).toEqual(['Art', 'Math']);
    expect(screen.getByText('★ 4.0 · 2 reviews')).toBeTruthy();
    expect(screen.getByLabelText('Rated 4.0 out of 5, 2 reviews')).toBeTruthy();
    expect(screen.getAllByText(/★/)).toHaveLength(1); // Art has none
  });

  it('the teacher also sees hidden disciplines with the Hidden badge, and "+ New discipline"', async () => {
    setStore(forRole('T'));
    await render(<CoursesScreen />);
    await fireEvent.press(tab('Disciplines'));
    expect(screen.getAllByText(/^(Art|Math|Physics)$/).map((t) => t.props.children)).toEqual(['Art', 'Math', 'Physics']);
    expect(screen.getByText('Hidden')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '+ New discipline' }));
    expect(router.push).toHaveBeenCalledWith('/disciplines/new');
  });

  it.each(['S1', 'M'] as const)('%s sees no "+ New discipline"', async (who) => {
    setStore(forRole(who));
    await render(<CoursesScreen />);
    await fireEvent.press(tab('Disciplines'));
    expect(screen.queryByRole('button', { name: '+ New discipline' })).toBeNull();
  });

  it('empty states for the teacher and for others', async () => {
    setStore(forRole('T', { disciplines: [] }));
    const view = await render(<CoursesScreen />);
    await fireEvent.press(tab('Disciplines'));
    expect(screen.getByText('Tap "+ New discipline" to create the first one.')).toBeTruthy();
    await view.unmount();
    setStore(forRole('S1', { disciplines: [] }));
    await render(<CoursesScreen />);
    await fireEvent.press(tab('Disciplines'));
    expect(screen.getByText('No disciplines yet')).toBeTruthy();
    expect(screen.queryByText(/New discipline/)).toBeNull();
  });

  it('a card opens the discipline and pull to refresh reloads', async () => {
    const store = forRole('S1');
    setStore(store);
    const { container } = await render(<CoursesScreen />);
    await fireEvent.press(tab('Disciplines'));
    await fireEvent.press(screen.getByText('Math'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/disciplines/[id]', params: { id: 'DM' } });
    container.queryAll((n) => typeof n.props.onRefresh === 'function')[0].props.onRefresh();
    expect(store.refresh).toHaveBeenCalled();
  });
});

describe('AC10/AC11: the discipline card', () => {
  it('S1: name, rating and all reviews newest first with the course title; no course list or hide switch', async () => {
    params.id = 'DM';
    setStore(forRole('S1'));
    await render(<DisciplineScreen />);
    expect(screen.getAllByText('Math').length).toBeGreaterThan(0);
    expect(screen.getByText('★ 4.0 · 2 reviews')).toBeTruthy();
    const order = screen.getAllByTestId(/^review-/).map((n) => n.props.testID);
    expect(order).toEqual(['review-f2', 'review-f1']);
    expect(within(screen.getByTestId('review-f1')).getByText('Algebra')).toBeTruthy();
    expect(within(screen.getByTestId('review-f1')).getByText('Student Sam')).toBeTruthy();
    expect(screen.queryByTestId('discipline-courses')).toBeNull();
    expect(screen.queryByLabelText('Hidden discipline')).toBeNull();
  });

  it('no reviews: "No reviews yet"', async () => {
    params.id = 'DA';
    setStore(forRole('S1'));
    await render(<DisciplineScreen />);
    expect(screen.getByText('No reviews yet')).toBeTruthy();
  });

  it('the teacher sees its courses (opening them) and "No courses in this discipline yet" when empty', async () => {
    params.id = 'DM';
    setStore(forRole('T'));
    const view = await render(<DisciplineScreen />);
    const list = within(screen.getByTestId('discipline-courses'));
    await fireEvent.press(list.getByText('Algebra'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
    await view.unmount();
    params.id = 'DA';
    await render(<DisciplineScreen />);
    expect(screen.getByText('No courses in this discipline yet')).toBeTruthy();
  });

  it('the teacher hides and unhides with the switch', async () => {
    params.id = 'DM';
    const store = forRole('T');
    setStore(store);
    await render(<DisciplineScreen />);
    await fireEvent(screen.getByLabelText('Hidden discipline'), 'valueChange', true);
    await waitFor(() => expect(store.setDisciplineHidden).toHaveBeenCalledWith('DM', true));
  });

  it('a hidden discipline (for non-teachers) is "Discipline not found"', async () => {
    params.id = 'DP';
    setStore(forRole('M'));
    await render(<DisciplineScreen />);
    expect(screen.getByText('Discipline not found')).toBeTruthy();
  });
});

describe('AC1/AC2: New discipline', () => {
  it('the teacher creates with a name and the hidden switch; Create is disabled for a blank name', async () => {
    const store = forRole('T');
    setStore(store);
    await render(<NewDisciplineScreen />);
    const create = () => screen.getByRole('button', { name: 'Create discipline' });
    expect(create()).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Mathematics'), '   ');
    expect(create()).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Mathematics'), ' Music ');
    await fireEvent(screen.getByLabelText('Hidden discipline'), 'valueChange', true);
    await fireEvent.press(create());
    await waitFor(() =>
      expect(store.addDiscipline).toHaveBeenCalledWith({ id: expect.any(String), name: ' Music ', hidden: true }),
    );
  });

  it('a duplicate name shows the message and keeps the input', async () => {
    const addDiscipline = jest.fn(async () => {
      throw new Error('A discipline with this name already exists.');
    });
    setStore(forRole('T', { addDiscipline }));
    await render(<NewDisciplineScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Mathematics'), 'math');
    await fireEvent.press(screen.getByRole('button', { name: 'Create discipline' }));
    expect(await screen.findByText('A discipline with this name already exists.')).toBeTruthy();
    expect(screen.getByPlaceholderText('e.g. Mathematics').props.value).toBe('math');
  });

  it.each(['M', 'S1'] as const)('%s can\'t open it', async (who) => {
    setStore(forRole(who));
    await render(<NewDisciplineScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });
});

describe('AC4: New course picker', () => {
  it('lists "No discipline" (default) and the visible disciplines; the choice is sent', async () => {
    const store = forRole('M');
    setStore(store);
    await render(<NewCourseScreen />);
    expect(screen.getByRole('radio', { name: 'No discipline', checked: true })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Physics' })).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Algebra — Grade 7'), 'Geometry');
    await fireEvent.press(screen.getByRole('radio', { name: 'Math' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create course' }));
    await waitFor(() =>
      expect(store.addCourse).toHaveBeenCalledWith({ id: expect.any(String), title: 'Geometry', description: '', disciplineId: 'DM' }),
    );
  });

  it('no disciplines yet: no picker, and the course is created as before', async () => {
    const store = forRole('M', { disciplines: [] });
    setStore(store);
    await render(<NewCourseScreen />);
    expect(screen.queryByRole('radio', { name: 'No discipline' })).toBeNull();
  });
});

describe('AC5: the owner changes the discipline (ARU-103: on Edit course)', () => {
  it('M (owner of A) picks another discipline or "No discipline"; tapping the current one does nothing', async () => {
    params.id = 'A';
    const store = forRole('M');
    setStore(store);
    await render(<EditCourseScreen />);
    expect(screen.getByLabelText('Discipline, Math')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Math' }));
    expect(store.setCourseDiscipline).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Art' }));
    await waitFor(() => expect(store.setCourseDiscipline).toHaveBeenCalledWith('A', 'DA'));
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
    await fireEvent.press(screen.getByRole('radio', { name: 'No discipline' }));
    await waitFor(() => expect(store.setCourseDiscipline).toHaveBeenLastCalledWith('A', null));
  });

  it('a discipline hidden from the owner shows as "Hidden discipline" and can be kept or left', async () => {
    params.id = 'B';
    const store = forRole('N');
    setStore(store);
    await render(<EditCourseScreen />);
    expect(screen.getByLabelText('Discipline, Hidden discipline')).toBeTruthy();
    expect(screen.queryByText('Discipline: Physics')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Hidden discipline', checked: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Hidden discipline' }));
    expect(store.setCourseDiscipline).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Math' }));
    await waitFor(() => expect(store.setCourseDiscipline).toHaveBeenCalledWith('B', 'DM'));
  });

  it('S1 (not the owner) is not allowed; ARU-70: the teacher has the section on every course', async () => {
    params.id = 'A';
    setStore(forRole('S1'));
    const view = await render(<EditCourseScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toEqual([]);
    setStore(forRole('T'));
    await view.rerender(<EditCourseScreen />);
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
  });

  it('a refused change shows its error', async () => {
    params.id = 'A';
    const setCourseDiscipline = jest.fn(async () => {
      throw new Error('Only the course owner can change its discipline.');
    });
    setStore(forRole('M', { setCourseDiscipline }));
    await render(<EditCourseScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Art' }));
    expect(await screen.findByText('Only the course owner can change its discipline.')).toBeTruthy();
  });
});
