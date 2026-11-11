// QA ARU-66: gaps in aru66-accountant-payments.test.tsx: the red border in the 1 pt theme red on the due card only,
// the due line read by screen readers with a chat-row card, a deadline already passed dropped at once, a listener
// removed while the payments screen is open, a paid course the accountant can't read (hidden) kept out of the Unpaid list, a listener without a profile, and a long title wrapping.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import ProfileScreen from '@/app/(tabs)/profile';
import CoursePaymentsScreen from '@/app/accountant/[id]';
import { formatDay, unpaidThisMonth } from '@/lib/billing';
import { colors, formatDate } from '@/lib/theme';
import type { Course, CourseBilling, User } from '@/lib/types';

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

describe('AC7: the listener\'s card', () => {
  it('the due card has a 1 pt border in the theme red; the other card keeps the normal border', async () => {
    setStore(forUser('S1', { loadPaymentDues: jest.fn(async () => [{ courseId: 'A', deadline: '2026-11-05' }]) }));
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByTestId('payment-due-A')).toBeTruthy());
    expect(borderOf(screen.getByTestId('payment-due-A') as never)).toEqual(
      expect.objectContaining({ borderWidth: 1, borderColor: colors.danger }),
    );
    expect(borderOf(screen.getByText(courseB.title) as never)?.borderColor).not.toBe(colors.danger);
  });

  it('a chat-row card: the due line is inside the content button screen readers read (no label hiding it)', async () => {
    setStore(forUser('S1', { loadPaymentDues: jest.fn(async () => [{ courseId: 'A', deadline: '2026-11-05' }]) }));
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByTestId('payment-due-A')).toBeTruthy());
    expect(screen.getByRole('button', { name: `Open chat for ${courseA.title}` })).toBeTruthy();
    let n = screen.getByTestId('payment-due-A').parent;
    while (n && n.props.accessibilityRole !== 'button') n = n.parent;
    expect(n).toBeTruthy();
    expect(n!.props.accessibilityLabel).toBeUndefined();
    expect(screen.getByText(`Payment due by ${formatDate(new Date(2026, 10, 5).toISOString())}`)).toBeTruthy();
  });

  // ARU-148 changed this rule: a deadline passed earlier this month now shows as overdue (not dropped); only a
  // deadline from an earlier month is never shown.
  it('a deadline from an earlier month is never shown; one passed this month shows as overdue (ARU-148)', async () => {
    setStore(forUser('S1', { loadPaymentDues: jest.fn(async () => [{ courseId: 'A', deadline: '2026-10-28' }]) }));
    const view = await render(<CoursesScreen />);
    await act(async () => {});
    expect(screen.queryByTestId('payment-due-A')).toBeNull();
    await view.unmount();
    setStore(forUser('S1', { loadPaymentDues: jest.fn(async () => [{ courseId: 'A', deadline: '2026-11-02' }]) }));
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByTestId('payment-due-A')).toBeTruthy());
    expect(screen.getByTestId('payment-due-A').props.children).toBe(`Payment overdue: was due ${formatDay('2026-11-02')}`);
  });

  it('the deadline is shown for its local day (no time-zone shift)', () => {
    expect(formatDay('2027-02-28')).toBe(formatDate(new Date(2027, 1, 28).toISOString()));
    expect(formatDay('2026-12-31')).toBe(formatDate(new Date(2026, 11, 31).toISOString()));
  });

  it('a long course title still shows the due line', async () => {
    const long: Course = { ...courseA, title: 'Advanced '.repeat(12).trim() };
    setStore(
      forUser('S1', {
        courses: [long, courseB],
        loadPaymentDues: jest.fn(async () => [{ courseId: 'A', deadline: '2026-11-05' }]),
      }),
    );
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByTestId('payment-due-A')).toBeTruthy());
    expect(screen.getByText(long.title).props.numberOfLines).not.toBe(1);
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
