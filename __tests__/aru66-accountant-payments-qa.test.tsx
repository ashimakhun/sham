// QA ARU-66: gaps in aru66-accountant-payments.test.tsx (the listener card part rewritten for ARU-161: no due line or
// border for listeners), a listener
// removed while the payments screen is open, a paid course the accountant can't read (hidden) kept out of the Unpaid list, a listener without a profile.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import ProfileScreen from '@/app/(tabs)/profile';
import CoursePaymentsScreen from '@/app/accountant/[id]';
import { formatDay, unpaidThisMonth } from '@/lib/billing';
import { colors, formatDate } from '@/lib/theme';
import type { CourseBilling, User } from '@/lib/types';

import { courseA, courseB, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const NOV_3 = new Date(2026, 10, 3, 10, 0).getTime();
const accountantM: User = { ...users.M, isAccountant: true };
const bill = (courseId: string, startDay = 1, endDay = 5): CourseBilling => ({
  courseId,
  startDay,
  endDay,
  selectedById: 'M',
  selectedAt: '2026-11-01T10:00:00.000Z',
});
const courseMembers = [member('A', 'S1'), member('A', 'S2'), member('B', 'S1')];
const allUsers = Object.values({ ...users, M: accountantM });
const forUser = (who: 'T' | 'M' | 'S1', over = {}) => {
  const base = fakeStore(who, { courses: [courseA, courseB], courseMembers, ...over });
  const me = who === 'M' ? accountantM : users[who];
  return { ...base, currentUser: me, users: allUsers, getUser: (id?: string) => allUsers.find((u) => u.id === id) };
};

/** The nearest ancestor (or the node) whose flattened style has a border width. */
function borderOf(node: { props: { style?: unknown }; parent: unknown } | null) {
  let n = node as { props: { style?: unknown }; parent: unknown } | null;
  while (n) {
    const s = StyleSheet.flatten(n.props.style as never) as { borderWidth?: number; borderColor?: string } | undefined;
    if (s?.borderWidth) return s;
    n = n.parent as typeof n;
  }
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOV_3);
});
afterEach(() => jest.restoreAllMocks());

// ARU-161 replaced ARU-66 AC 7's listener card: no due line and no red border for listeners any more, and the
// Courses tab no longer loads my_payment_dues(). The deadline formatting stays (the accountant screens use it).
describe('AC7 (since ARU-161): the listener\'s card shows no payment', () => {
  it('an owed course has no due line and no red border, like a paid one; dues are not even loaded', async () => {
    const loadPaymentDues = jest.fn(async () => [{ courseId: 'A', deadline: '2026-11-05' }]);
    setStore(forUser('S1', { loadPaymentDues }));
    await render(<CoursesScreen />);
    await act(async () => {});
    expect(screen.getByText(courseA.title)).toBeTruthy();
    expect(screen.queryByTestId('payment-due-A')).toBeNull();
    expect(screen.queryByText(/Payment (due|overdue)/)).toBeNull();
    expect(borderOf(screen.getByText(courseA.title) as never)?.borderColor).not.toBe(colors.danger);
    expect(loadPaymentDues).not.toHaveBeenCalled();
  });

  it('a chat-row card: still no due line, and the content button keeps no label hiding the card text', async () => {
    setStore(forUser('S1', { loadPaymentDues: jest.fn(async () => [{ courseId: 'A', deadline: '2026-11-02' }]) }));
    await render(<CoursesScreen />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: `Open chat for ${courseA.title}` })).toBeTruthy();
    expect(screen.queryByTestId('payment-due-A')).toBeNull();
    let n = screen.getByText(courseA.title).parent;
    while (n && n.props.accessibilityRole !== 'button') n = n.parent;
    expect(n!.props.accessibilityLabel).toBeUndefined();
  });

  it('the deadline is shown for its local day (no time-zone shift)', () => {
    expect(formatDay('2027-02-28')).toBe(formatDate(new Date(2027, 1, 28).toISOString()));
    expect(formatDay('2026-12-31')).toBe(formatDate(new Date(2026, 11, 31).toISOString()));
  });
});

describe('AC1: the payments screen', () => {
  beforeEach(() => {
    params.id = 'A';
  });

  it('a listener removed while the screen is open disappears from it', async () => {
    setStore(forUser('M', { courseBilling: [bill('A')] }));
    const view = await render(<CoursePaymentsScreen />);
    expect(screen.getByTestId('payment-S2')).toBeTruthy();
    setStore(forUser('M', { courseBilling: [bill('A')], courseMembers: [member('A', 'S1')] }));
    await view.rerender(<CoursePaymentsScreen />);
    expect(screen.queryByTestId('payment-S2')).toBeNull();
    expect(screen.getByTestId('payment-S1')).toBeTruthy();
  });

  it('a listener whose profile can\'t be read is listed as Unknown and can still be marked', async () => {
    const store = forUser('M', { courseBilling: [bill('A')], courseMembers: [member('A', 'GONE')] });
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark Unknown paid' }));
    await waitFor(() => expect(store.markPaid).toHaveBeenCalledWith('A', 'GONE', '2026-11-01'));
  });
});

describe('AC3: "Unpaid this month"', () => {
  it('a paid course the accountant can\'t read (hidden, ARU-40) is left out', () => {
    const list = unpaidThisMonth({
      billing: [bill('A'), bill('HIDDEN')],
      getCourse: (id) => [courseA, courseB].find((c) => c.id === id),
      members: [...courseMembers, member('HIDDEN', 'S2')],
      getUser: (id) => allUsers.find((u) => u.id === id),
      payments: [],
      exemptions: [],
      now: NOV_3,
    });
    expect(list?.map((c) => c.courseId)).toEqual(['A']);
  });

  it('only a hidden (unreadable) course in its period: the block isn\'t shown', async () => {
    setStore(forUser('M', { courseBilling: [bill('HIDDEN'), bill('B', 10, 15)] }));
    await render(<ProfileScreen />);
    expect(screen.queryByTestId('unpaid-this-month')).toBeNull();
  });

  it('the period ending on the device clock while the section is open hides the block', async () => {
    jest.restoreAllMocks();
    jest.useFakeTimers({ now: new Date(2026, 10, 5, 23, 59, 50), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      setStore(forUser('M', { courseBilling: [bill('A')] }));
      await render(<ProfileScreen />);
      expect(screen.getByTestId('unpaid-this-month')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(screen.queryByTestId('unpaid-this-month')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
