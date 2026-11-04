// QA ARU-65: gaps in aru65-accountant.test.tsx: screen-reader increment / decrement on the day steppers (clamped to
// 1–28), selecting with a custom period, Cancel sends nothing, a failed select keeps the editor and its days, a
// declined mentor with the flag gets no section, the Hidden badge and long titles in Select courses, the Manage roles
// switch reflecting each mentor's saved value, and the teacher getting no Unselect on any row.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import CoursePaymentsScreen from '@/app/accountant/[id]';
import SelectPaidCoursesScreen from '@/app/accountant/courses';
import RolesScreen from '@/app/roles';
import type { Course, CourseBilling, User } from '@/lib/types';

import { courseA, courseB, fakeStore, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const accountantM: User = { ...users.M, isAccountant: true };
const H: Course = { id: 'H', title: 'Hidden '.repeat(20).trim(), description: '', createdById: 'M', createdAt: '2026-10-05T10:00:00.000Z', hidden: true };
const courses = [H, courseB, courseA];
const bill = (courseId: string, startDay = 1, endDay = 5): CourseBilling => ({
  courseId,
  startDay,
  endDay,
  selectedById: 'M',
  selectedAt: '2026-11-01T10:00:00.000Z',
});
const as = (me: User, over: Parameters<typeof fakeStore>[1] = {}) => {
  const everyone = Object.values({ ...users, [me.id]: me });
  return { ...fakeStore(me.id as keyof typeof users, { courses, ...over }), currentUser: me, users: everyone, getUser: (id?: string) => everyone.find((u) => u.id === id) };
};
const a11y = (node: unknown, actionName: 'increment' | 'decrement') =>
  fireEvent(node as never, 'accessibilityAction', { nativeEvent: { actionName } });

beforeEach(() => jest.clearAllMocks());

it('edge screen readers: increment / decrement change the day and stop at 1 and 28', async () => {
  // ARU-99: Change period moved from the Profile row to the course payments page.
  const store = as(accountantM, { courseBilling: [bill('A', 2, 27)] });
  setStore(store);
  params.id = 'A';
  await render(<CoursePaymentsScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Change period' }));
  const first = () => screen.getByLabelText('First day');
  const last = () => screen.getByLabelText('Last day');
  expect(first().props.accessibilityRole).toBe('adjustable');
  await a11y(first(), 'decrement');
  await a11y(first(), 'decrement'); // already 1: stays
  expect(first().props.accessibilityValue).toMatchObject({ now: 1, text: 'Day 1', min: 1, max: 28 });
  await a11y(last(), 'increment');
  await a11y(last(), 'increment'); // already 28: stays
  expect(last().props.accessibilityValue.now).toBe(28);
  await fireEvent.press(screen.getByRole('button', { name: 'Save period' }));
  await waitFor(() => expect(store.setBillingPeriod).toHaveBeenCalledWith('A', 1, 28));
});

describe('AC 3: Select courses', () => {
  it('selecting with a custom period sends those days', async () => {
    const store = as(accountantM);
    setStore(store);
    await render(<SelectPaidCoursesScreen />);
    await fireEvent.press(within(screen.getByTestId('select-A')).getByRole('button', { name: 'Select' }));
    const row = within(screen.getByTestId('select-A'));
    for (let i = 0; i < 9; i++) await fireEvent.press(row.getByRole('button', { name: 'Last day, later' }));
    for (let i = 0; i < 9; i++) await fireEvent.press(row.getByRole('button', { name: 'First day, later' }));
    await fireEvent.press(row.getByRole('button', { name: 'Select' }));
    await waitFor(() => expect(store.selectPaidCourse).toHaveBeenCalledWith('A', 10, 14));
  });

  it('Cancel closes the editor and sends nothing', async () => {
    const store = as(accountantM);
    setStore(store);
    await render(<SelectPaidCoursesScreen />);
    await fireEvent.press(within(screen.getByTestId('select-A')).getByRole('button', { name: 'Select' }));
    await fireEvent.press(within(screen.getByTestId('select-A')).getByRole('button', { name: 'Cancel' }));
    expect(within(screen.getByTestId('select-A')).queryByLabelText('First day')).toBeNull();
    expect(store.selectPaidCourse).not.toHaveBeenCalled();
  });

  it('edge offline: a failed select shows the error and keeps the editor with its days; a retry is sent', async () => {
    const selectPaidCourse = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(undefined);
    setStore(as(accountantM, { selectPaidCourse }));
    await render(<SelectPaidCoursesScreen />);
    const row = () => within(screen.getByTestId('select-B'));
    await fireEvent.press(row().getByRole('button', { name: 'Select' }));
    await fireEvent.press(row().getByRole('button', { name: 'Last day, later' }));
    await fireEvent.press(row().getByRole('button', { name: 'Select' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(row().getByLabelText('Last day').props.accessibilityValue.now).toBe(6);
    await fireEvent.press(row().getByRole('button', { name: 'Select' }));
    await waitFor(() => expect(selectPaidCourse).toHaveBeenLastCalledWith('B', 1, 6));
  });

  it('a hidden course the accountant is in shows its Hidden badge, and a long title is not cut', async () => {
    setStore(as(accountantM));
    await render(<SelectPaidCoursesScreen />);
    const row = within(screen.getByTestId('select-H'));
    expect(row.getByText('Hidden')).toBeTruthy();
    expect(row.getByText(H.title).props.numberOfLines).toBeUndefined();
  });
});

it('AC 2: a declined mentor whose flag is still on gets no Accountant section', async () => {
  setStore(as({ ...accountantM, accessStatus: 'rejected' }, { courseBilling: [bill('A')] }));
  await render(<ProfileScreen />);
  expect(screen.queryByTestId('accountant-section')).toBeNull();
});

// ARU-99: Change period and Unselect moved to the course payments page; the Profile rows only open it.
it('AC 6: the teacher gets Change period on every payments page and Unselect on none; rows keep their order', async () => {
  setStore(as(users.T, { courseBilling: [bill('A'), bill('B', 10, 12), bill('H', 28, 28)] }));
  const view = await render(<ProfileScreen />);
  expect(screen.queryByRole('button', { name: 'Change period' })).toBeNull();
  const order = screen.getAllByTestId(/^paid-/).map((n) => n.props.testID);
  expect(order).toEqual(['paid-A', 'paid-B', 'paid-H']); // Algebra, Biology, Hidden…
  await view.unmount();
  for (const id of ['A', 'B', 'H']) {
    params.id = id;
    const page = await render(<CoursePaymentsScreen />);
    expect(screen.getByRole('button', { name: 'Change period' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unselect' })).toBeNull();
    if (id === 'H') expect(screen.getByText('Pays 28 of each month')).toBeTruthy();
    await page.unmount();
  }
});

it('AC 1: each mentor\'s switch shows their saved value', async () => {
  const everyone = Object.values({ ...users, M: accountantM });
  setStore({ ...fakeStore('T'), users: everyone, getUser: (id?: string) => everyone.find((u) => u.id === id) });
  await render(<RolesScreen />);
  expect(screen.getByLabelText(`Accountant, ${users.M.name}`).props.value).toBe(true);
  expect(screen.getByLabelText(`Accountant, ${users.N.name}`).props.value).toBe(false);
});
