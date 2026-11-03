// ARU-80: course details loses its homework list; the Homework tab's Checked list gets a "Filter: <All courses |
// course>" button (the ARU-62 author filter, generalised), on the checker view and the listener view. UI only.
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import MaterialsScreen from '@/app/(tabs)/materials';
import CourseDetailScreen from '@/app/courses/[id]';
import type { Course, Homework } from '@/lib/types';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courseC: Course = { id: 'C', title: 'algebra', description: '', createdById: 'M', createdAt: '2026-10-03T10:00:00.000Z' };
const courseD: Course = { id: 'D', title: 'Biology', description: '', createdById: 'M', createdAt: '2026-10-04T10:00:00.000Z' };
const courses = [courseB, courseA, courseC, courseD];

const HOMEWORK: Homework[] = [
  hw({ id: 'a1', courseId: 'A', studentId: 'S1', title: 'HW A1 checked', status: 'checked', checkedById: 'M' }),
  hw({ id: 'b1', courseId: 'B', studentId: 'S1', title: 'HW B1 checked', status: 'checked', checkedById: 'M' }),
  hw({ id: 'a2', courseId: 'A', studentId: 'S1', title: 'HW A2 checked', status: 'checked', checkedById: 'N' }),
  hw({ id: 'c1', courseId: 'C', studentId: 'S1', title: 'HW C1 waiting' }),
  hw({ id: 'd1', courseId: 'D', studentId: 'S1', title: 'HW D1 checked', status: 'checked', checkedById: 'M' }),
  hw({ id: 'x1', courseId: 'GONE', studentId: 'S1', title: 'HW X1 checked', status: 'checked', checkedById: 'M' }),
  // M2's own homework (listener side).
  hw({ id: 'm1', courseId: 'B', studentId: 'M2', title: 'HW M1 checked', status: 'checked', checkedById: 'M' }),
  hw({ id: 'm2', courseId: 'A', studentId: 'M2', title: 'HW M2 waiting' }),
];
const members = [member('A', 'S1'), member('B', 'S1'), member('A', 'M2'), member('B', 'M2')];

const filterButton = () => screen.queryByRole('button', { name: /^Filter by course, / });
const entries = () =>
  within(screen.getByTestId('course-filter-list'))
    .getAllByRole('button')
    .map((b) => ({ label: b.props.accessibilityLabel as string, value: !!b.props.accessibilityState?.selected }));
const pick = async (index: number) =>
  fireEvent.press(within(screen.getByTestId('course-filter-list')).getAllByRole('button')[index]);
const titles = () => screen.queryAllByText(/^HW /).map((t) => t.props.children);
const tab = (name: 'Owner' | 'Listener') => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

// RLS gives a student only their own homework.
const S1_ONLY = HOMEWORK.filter((h) => h.studentId === 'S1');
const open = async (who: 'S1' | 'M2' | 'T' | 'M', visibleHomework = who === 'S1' ? S1_ONLY : HOMEWORK) => {
  setStore(fakeStore(who, { courses, courseMembers: members, visibleHomework }));
  return render(<HomeworkScreen />);
};

beforeEach(() => jest.clearAllMocks());

describe('AC1/AC2: course details', () => {
  it.each(['S1', 'M', 'T'] as const)('%s: no HOMEWORK label, cards or empty state; History still last', async (who) => {
    params.id = 'A';
    setStore(fakeStore(who, { courses, courseMembers: members, visibleHomework: HOMEWORK }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByText('HOMEWORK')).toBeNull();
    expect(screen.queryByText('No homework for this course yet')).toBeNull();
    expect(titles()).toEqual([]);
    expect(screen.getByText(/^MEETINGS/)).toBeTruthy();
  });

  it('pull-to-refresh still works', async () => {
    params.id = 'A';
    const store = fakeStore('T', { courses, courseMembers: members });
    setStore(store);
    await render(<CourseDetailScreen />);
    let node = screen.getByText('Equations and more').parent;
    while (node && !node.props.refreshControl) node = node.parent;
    await node!.props.refreshControl.props.onRefresh();
    expect(store.refresh).toHaveBeenCalled();
  });

  it('AC2: the summary for a student who is not in the course is unchanged', async () => {
    params.id = 'A';
    setStore(fakeStore('S2', { courses, courseMembers: members, visibleHomework: HOMEWORK }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('You are not in this course')).toBeTruthy();
    expect(screen.getByText('Equations and more')).toBeTruthy();
  });
});

describe('AC3/AC4: only on Checked', () => {
  it('teacher: no filter on To check; "Filter: All courses" on Checked', async () => {
    await open('T');
    expect(filterButton()).toBeNull();
    await fireEvent.press(screen.getByText('Checked'));
    expect(filterButton()!.props.accessibilityLabel).toBe('Filter by course, All courses');
    expect(filterButton()!.props.accessibilityHint).toBe('Opens the list of courses');
    expect(screen.getByText('Filter: All courses')).toBeTruthy();
    expect(screen.queryByTestId('course-filter-list')).toBeNull();
  });

  it('student: no filter on New or Waiting; shown on Checked', async () => {
    await open('S1');
    expect(filterButton()).toBeNull();
    await fireEvent.press(screen.getByText(/^Waiting/));
    expect(filterButton()).toBeNull();
    expect(titles()).toEqual(['HW C1 waiting']);
    await fireEvent.press(screen.getByText('Checked'));
    expect(filterButton()).toBeTruthy();
  });

  it('mentor: shown on Owner/Checked and Listener/Checked', async () => {
    await open('M2');
    expect(filterButton()).toBeNull();
    await fireEvent.press(screen.getByText('Checked'));
    expect(filterButton()).toBeTruthy();
    await fireEvent.press(tab('Listener'));
    expect(filterButton()).toBeNull(); // opens on New
    await fireEvent.press(screen.getByText('Checked'));
    expect(filterButton()).toBeTruthy();
  });
});

describe('AC5/AC6/AC10: options and filtering', () => {
  it('All courses first, then courses of the checked list by title (case-insensitive, by id); "No course" for unknown', async () => {
    await open('S1');
    await fireEvent.press(screen.getByText('Checked'));
    await fireEvent.press(filterButton()!);
    expect(screen.getByRole('header', { name: 'Filter by course' })).toBeTruthy();
    expect(entries()).toEqual([
      { label: 'All courses', value: true },
      { label: 'Algebra', value: false },
      { label: 'Biology', value: false },
      { label: 'Biology', value: false },
      { label: 'No course', value: false },
    ]);
    // "algebra" (C) only has waiting homework, so it is not listed.
  });

  it('picking a course narrows the list in today\'s order; All courses restores it; no network call', async () => {
    await open('S1');
    await fireEvent.press(screen.getByText('Checked'));
    expect(titles()).toEqual(['HW A1 checked', 'HW B1 checked', 'HW A2 checked', 'HW D1 checked', 'HW X1 checked']);
    await fireEvent.press(filterButton()!);
    await pick(1);
    expect(screen.queryByTestId('course-filter-list')).toBeNull();
    expect(filterButton()!.props.accessibilityLabel).toBe('Filter by course, Algebra');
    expect(titles()).toEqual(['HW A1 checked', 'HW A2 checked']);
    // Same-title courses are separate: the second "Biology" is D.
    await fireEvent.press(filterButton()!);
    await pick(3);
    expect(titles()).toEqual(['HW D1 checked']);
    await fireEvent.press(filterButton()!);
    await pick(0);
    expect(titles()).toHaveLength(5);
  });

  it('the Blog author filter keeps its wording and testIDs', async () => {
    setStore(fakeStore('S1', { materials: [{ id: 'x', teacherId: 'T', title: 'Material x', body: '', createdAt: '2026-10-01T10:00:00.000Z' }] }));
    await render(<MaterialsScreen />);
    const button = screen.getByRole('button', { name: 'Filter by author, All' });
    expect(button.props.accessibilityHint).toBe('Opens the list of authors');
    await fireEvent.press(button);
    expect(screen.getByTestId('author-filter-list')).toBeTruthy();
    expect(screen.getByTestId('author-filter-backdrop', { includeHiddenElements: true }).props.accessibilityLabel).toBe('Close author filter');
    expect(screen.getByRole('header', { name: 'Filter by author' })).toBeTruthy();
  });

  it('the course filter has its own close control', async () => {
    await open('S1');
    await fireEvent.press(screen.getByText('Checked'));
    await fireEvent.press(filterButton()!);
    const backdrop = screen.getByTestId('course-filter-backdrop', { includeHiddenElements: true });
    expect(backdrop.props.accessibilityLabel).toBe('Close course filter');
    await fireEvent.press(backdrop);
    expect(screen.queryByTestId('course-filter-list')).toBeNull();
  });
});

describe('AC7/AC9: live list changes', () => {
  it('the chosen course\'s last checked homework disappears → All courses', async () => {
    const view = await open('S1');
    await fireEvent.press(screen.getByText('Checked'));
    await fireEvent.press(filterButton()!);
    await pick(3); // Biology (D)
    expect(titles()).toEqual(['HW D1 checked']);
    setStore(fakeStore('S1', { courses, courseMembers: members, visibleHomework: S1_ONLY.filter((h) => h.id !== 'd1') }));
    await view.rerender(<HomeworkScreen />);
    expect(filterButton()!.props.accessibilityLabel).toBe('Filter by course, All courses');
    expect(titles()).toHaveLength(4);
  });

  it('a newly checked homework shows in the filtered list and its course joins the options', async () => {
    const view = await open('S1');
    await fireEvent.press(screen.getByText('Checked'));
    await fireEvent.press(filterButton()!);
    await pick(1); // Algebra
    const next = S1_ONLY.map((h) => (h.id === 'c1' ? { ...h, status: 'checked' as const, checkedById: 'M' } : h)).concat(
      hw({ id: 'a3', courseId: 'A', studentId: 'S1', title: 'HW A3 checked', status: 'checked', checkedById: 'M' }),
    );
    setStore(fakeStore('S1', { courses, courseMembers: members, visibleHomework: next }));
    await view.rerender(<HomeworkScreen />);
    expect(titles()).toEqual(['HW A1 checked', 'HW A2 checked', 'HW A3 checked']);
    await fireEvent.press(filterButton()!);
    expect(entries().map((e) => e.label)).toEqual(['All courses', 'Algebra', 'algebra', 'Biology', 'Biology', 'No course']);
  });

  it('no checked homework: only All courses, and today\'s empty state', async () => {
    await open('S1', [HOMEWORK[3]]);
    await fireEvent.press(screen.getByText('Checked'));
    expect(screen.getByText('No homework yet')).toBeTruthy();
    await fireEvent.press(filterButton()!);
    expect(entries()).toEqual([{ label: 'All courses', value: true }]);
  });
});

describe('AC8: per tab for mentors', () => {
  it('Owner and Listener keep their own choice; switching tabs opens the default list', async () => {
    await open('M2');
    await fireEvent.press(screen.getByText('Checked'));
    await fireEvent.press(filterButton()!);
    await pick(1); // Owner: Algebra
    expect(titles()).toEqual(['HW A1 checked', 'HW A2 checked']);

    await fireEvent.press(tab('Listener'));
    expect(screen.getByText(/^New \(/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Checked'));
    expect(filterButton()!.props.accessibilityLabel).toBe('Filter by course, All courses');
    expect(titles()).toEqual(['HW M1 checked']);
    await fireEvent.press(filterButton()!);
    expect(entries().map((e) => e.label)).toEqual(['All courses', 'Biology']);
    await pick(1);

    await fireEvent.press(tab('Owner'));
    expect(filterButton()).toBeNull(); // opens on To check
    await fireEvent.press(screen.getByText('Checked'));
    expect(filterButton()!.props.accessibilityLabel).toBe('Filter by course, Algebra');
    expect(titles()).toEqual(['HW A1 checked', 'HW A2 checked']);

    await fireEvent.press(tab('Listener'));
    await fireEvent.press(screen.getByText('Checked'));
    expect(filterButton()!.props.accessibilityLabel).toBe('Filter by course, Biology');
  });
});
