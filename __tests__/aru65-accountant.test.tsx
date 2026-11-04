// ARU-65: Accountant switch, paid courses and payment periods (UI side). Rules are tested in
// supabase/tests/aru65_accountant.test.sql. Teacher T; mentors M (Accountant on) and N (off); students S1, S2.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';

import ProfileScreen from '@/app/(tabs)/profile';
import CoursePaymentsScreen from '@/app/accountant/[id]';
import SelectPaidCoursesScreen from '@/app/accountant/courses';
import RolesScreen from '@/app/roles';
import { canSeeBilling, isAccountant, periodProblem, periodText } from '@/lib/billing';
import type { Course, CourseBilling, User } from '@/lib/types';

import { courseA, courseB, fakeStore, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const accountantM: User = { ...users.M, isAccountant: true };
const courseC: Course = { id: 'C', title: 'Chemistry', description: '', createdById: 'N', createdAt: '2026-10-03T10:00:00.000Z' };
const courses = [courseC, courseB, courseA];
const bill = (courseId: string, startDay = 1, endDay = 5): CourseBilling => ({
  courseId,
  startDay,
  endDay,
  selectedById: 'M',
  selectedAt: '2026-11-01T10:00:00.000Z',
});
const allUsers = Object.values({ ...users, M: accountantM });
const forUser = (who: 'T' | 'M' | 'N' | 'S1', over = {}) => {
  const base = fakeStore(who, { courses, ...over });
  const me = who === 'M' ? accountantM : users[who];
  return { ...base, currentUser: me, users: allUsers, getUser: (id?: string) => allUsers.find((u) => u.id === id) };
};
const answer = (choice: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === choice)?.onPress?.();
  });

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('helpers', () => {
  it('period text, validation and who sees billing', () => {
    expect(periodText({ startDay: 1, endDay: 5 })).toBe('Pays 1–5 of each month');
    expect(periodText({ startDay: 7, endDay: 7 })).toBe('Pays 7 of each month');
    expect(periodProblem(1, 5)).toBeNull();
    expect(periodProblem(16, 15)).toMatch(/before/);
    expect(periodProblem(0, 5)).toMatch(/1 and 28/);
    expect(periodProblem(1, 29)).toMatch(/1 and 28/);
    expect(isAccountant(accountantM)).toBe(true);
    expect(isAccountant(users.M)).toBe(false);
    expect(isAccountant({ ...users.S1, isAccountant: true })).toBe(false);
    expect(isAccountant({ ...accountantM, accessStatus: 'pending' })).toBe(false);
    expect(canSeeBilling(users.T)).toBe(true);
    expect(canSeeBilling(users.N)).toBe(false);
    expect(canSeeBilling(users.S1)).toBe(false);
  });
});

describe('AC1: Accountant switch on Manage roles', () => {
  it('each mentor has a switch; students and the teacher don\'t; toggling calls setAccountant', async () => {
    const store = forUser('T');
    setStore(store);
    await render(<RolesScreen />);
    expect(screen.getByLabelText('Accountant, Mentor Max').props.value).toBe(true);
    expect(screen.getByLabelText('Accountant, Mentor Nina').props.value).toBe(false);
    expect(screen.queryByLabelText('Accountant, Student Sam')).toBeNull();
    expect(screen.queryByLabelText('Accountant, Teacher Tess')).toBeNull();
    await fireEvent(screen.getByLabelText('Accountant, Mentor Nina'), 'valueChange', true);
    await waitFor(() => expect(store.setAccountant).toHaveBeenCalledWith('N', true));
    await fireEvent(screen.getByLabelText('Accountant, Mentor Max'), 'valueChange', false);
    await waitFor(() => expect(store.setAccountant).toHaveBeenLastCalledWith('M', false));
  });

  it('a refused switch shows the error', async () => {
    const setAccountant = jest.fn(async () => {
      throw new Error('Only mentors can be accountants.');
    });
    setStore(forUser('T', { setAccountant }));
    await render(<RolesScreen />);
    await fireEvent(screen.getByLabelText('Accountant, Mentor Nina'), 'valueChange', true);
    expect(await screen.findByText('Only mentors can be accountants.')).toBeTruthy();
  });
});

describe('AC2/AC6/AC7: the Accountant section on Profile', () => {
  // ARU-99 AC 5: the period moved to the course's payments page; the row is the title with ">".
  it('an accountant sees every paid course sorted by title, and "Select courses"', async () => {
    setStore(forUser('M', { courseBilling: [bill('C', 10, 15), bill('A')] }));
    await render(<ProfileScreen />);
    const section = within(screen.getByTestId('accountant-section'));
    expect(section.getAllByText(/^(Algebra|Biology|Chemistry)$/).map((t) => t.props.children)).toEqual(['Algebra', 'Chemistry']);
    expect(section.queryByText(/^Pays /)).toBeNull();
    await fireEvent.press(section.getByRole('button', { name: 'Select courses' }));
    expect(router.push).toHaveBeenCalledWith('/accountant/courses');
  });

  it('the teacher sees the paid courses but has no Select courses; Change period is on the payments page, Unselect isn\'t', async () => {
    setStore(forUser('T', { courseBilling: [bill('A')] }));
    const view = await render(<ProfileScreen />);
    const section = within(screen.getByTestId('accountant-section'));
    expect(section.getByText('Algebra')).toBeTruthy();
    expect(section.queryByRole('button', { name: 'Change period' })).toBeNull();
    expect(section.queryByRole('button', { name: 'Select courses' })).toBeNull();
    await view.unmount();
    await render(<CoursePaymentsScreen />);
    expect(screen.getByText('Pays 1–5 of each month')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change period' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unselect' })).toBeNull();
  });

  it.each(['N', 'S1'] as const)('%s (not an accountant) has no Accountant section', async (who) => {
    setStore(forUser(who, { courseBilling: [bill('A')] }));
    await render(<ProfileScreen />);
    expect(screen.queryByTestId('accountant-section')).toBeNull();
  });

  it('no paid courses: "No paid courses yet", plus the hint for accountants only', async () => {
    setStore(forUser('M'));
    const view = await render(<ProfileScreen />);
    expect(screen.getByText('No paid courses yet')).toBeTruthy();
    expect(screen.getByText('Tap "Select courses" to add one.')).toBeTruthy();
    await view.unmount();
    setStore(forUser('T'));
    await render(<ProfileScreen />);
    expect(screen.getByText('No paid courses yet')).toBeTruthy();
    expect(screen.queryByText('Tap "Select courses" to add one.')).toBeNull();
  });

  it('a billing row for a course the user can\'t read isn\'t listed', async () => {
    setStore(forUser('M', { courseBilling: [bill('GONE')] }));
    await render(<ProfileScreen />);
    expect(screen.getByText('No paid courses yet')).toBeTruthy();
  });
});

// ARU-99 AC 8: Change period is on the course's payments page now.
describe('AC4: changing a period', () => {
  it('the steppers stay within 1–28, start after end is refused, and Save sends the new days', async () => {
    const store = forUser('T', { courseBilling: [bill('A')] });
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Change period' }));
    expect(screen.getByRole('button', { name: 'First day, earlier' })).toBeDisabled();
    for (let i = 0; i < 5; i++) await fireEvent.press(screen.getByRole('button', { name: 'First day, later' }));
    expect(screen.getByText('The first payment day must come before the last one.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save period' })).toBeDisabled();
    for (let i = 0; i < 5; i++) await fireEvent.press(screen.getByRole('button', { name: 'Last day, later' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save period' }));
    await waitFor(() => expect(store.setBillingPeriod).toHaveBeenCalledWith('A', 6, 10));
  });

  it('the last day can\'t go past 28', async () => {
    setStore(forUser('M', { courseBilling: [bill('A', 1, 27)] }));
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Change period' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Last day, later' }));
    expect(screen.getByRole('button', { name: 'Last day, later' })).toBeDisabled();
  });

  it('a failed save shows the error and keeps the editor open', async () => {
    const setBillingPeriod = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    setStore(forUser('M', { courseBilling: [bill('A')], setBillingPeriod }));
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Change period' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save period' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save period' })).toBeTruthy();
  });
});

describe('AC3/AC5: Select courses', () => {
  it('lists every course the accountant can see, A–Z; selecting asks for the period (default 1–5)', async () => {
    const store = forUser('M', { courseBilling: [bill('B')] });
    setStore(store);
    await render(<SelectPaidCoursesScreen />);
    expect(screen.getAllByText(/^(Algebra|Biology|Chemistry)$/).map((t) => t.props.children)).toEqual([
      'Algebra',
      'Biology',
      'Chemistry',
    ]);
    expect(within(screen.getByTestId('select-B')).getByText('Paid course · Pays 1–5 of each month')).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId('select-C')).getByRole('button', { name: 'Select' }));
    const row = within(screen.getByTestId('select-C'));
    expect(row.getByLabelText('First day').props.accessibilityValue.now).toBe(1);
    expect(row.getByLabelText('Last day').props.accessibilityValue.now).toBe(5);
    await fireEvent.press(row.getByRole('button', { name: 'Select' }));
    await waitFor(() => expect(store.selectPaidCourse).toHaveBeenCalledWith('C', 1, 5));
  });

  it('unselecting (any accountant\'s course) asks first; Keep changes nothing', async () => {
    answer('Keep');
    const store = forUser('M', { courseBilling: [{ ...bill('B'), selectedById: 'N' }] });
    setStore(store);
    await render(<SelectPaidCoursesScreen />);
    await fireEvent.press(within(screen.getByTestId('select-B')).getByRole('button', { name: 'Unselect' }));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(store.unselectPaidCourse).not.toHaveBeenCalled();
    answer('Unselect');
    await fireEvent.press(within(screen.getByTestId('select-B')).getByRole('button', { name: 'Unselect' }));
    await waitFor(() => expect(store.unselectPaidCourse).toHaveBeenCalledWith('B'));
  });

  it('unselect from the course payments page (ARU-99 AC 8) also asks first', async () => {
    answer('Unselect');
    const store = forUser('M', { courseBilling: [bill('A')] });
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Unselect' }));
    await waitFor(() => expect(store.unselectPaidCourse).toHaveBeenCalledWith('A'));
  });

  it.each(['T', 'N', 'S1'] as const)('%s (not an accountant) can\'t open Select courses', async (who) => {
    setStore(forUser(who));
    await render(<SelectPaidCoursesScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });
});
