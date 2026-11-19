// ARU-66: Accountant payments (UI side). Rules are tested in supabase/tests/aru66_accountant_payments.test.sql.
// Teacher T; mentor M (Accountant on); mentor N (off); students S1, S2, S3 (Abby). Course A (paid, days 1-5) has
// listeners S1, S2, S3; B (paid, days 10-15) has S1; C is paid (1-5) with no unpaid listeners. The device date is
// 3 Nov 2026 unless a test changes it.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { router } from 'expo-router';

import CoursesScreen from '@/app/(tabs)/courses';
import ProfileScreen from '@/app/(tabs)/profile';
import CoursePaymentsScreen from '@/app/accountant/[id]';
import {
  inPeriod,
  localDay,
  localMonth,
  paymentDueText,
  paymentStatus,
  unpaidThisMonth,
} from '@/lib/billing';
import { formatDate } from '@/lib/theme';
import type { Course, CourseBilling, CoursePayment, User } from '@/lib/types';

import { courseA, courseB, fakeStore, member, users } from './helpers/fakeStore';
import { params, refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const NOV_3 = new Date(2026, 10, 3, 10, 0).getTime();
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
const pay = (courseId: string, userId: string, month = '2026-11-01'): CoursePayment => ({
  courseId,
  userId,
  month,
  markedById: 'T',
  markedAt: new Date(2026, 10, 2, 12).toISOString(),
});
const courseMembers = [member('A', 'S1'), member('A', 'S2'), member('A', 'S3'), member('B', 'S1'), member('C', 'S2')];
const allUsers = Object.values({ ...users, M: accountantM });
const forUser = (who: 'T' | 'M' | 'N' | 'S1', over = {}) => {
  const base = fakeStore(who, { courses, courseMembers, ...over });
  const me = who === 'M' ? accountantM : users[who];
  return { ...base, currentUser: me, users: allUsers, getUser: (id?: string) => allUsers.find((u) => u.id === id) };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOV_3);
});
afterEach(() => jest.restoreAllMocks());

describe('helpers', () => {
  it('local day and month, period, status and the due text', () => {
    expect(localDay(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-31');
    expect(localMonth(new Date(2026, 11, 1, 0, 5))).toBe('2026-12-01');
    expect(inPeriod({ startDay: 1, endDay: 5 }, new Date(2026, 10, 5))).toBe(true);
    expect(inPeriod({ startDay: 1, endDay: 5 }, new Date(2026, 10, 6))).toBe(false);
    expect(paymentDueText('2026-11-05')).toBe(`Payment due by ${formatDate(new Date(2026, 10, 5).toISOString())}`);
    // Exempt wins over a Paid mark; a mark of another month doesn't count.
    expect(paymentStatus('A', 'S1', '2026-11-01', [pay('A', 'S1')], [{ courseId: 'A', userId: 'S1' }]).kind).toBe('exempt');
    expect(paymentStatus('A', 'S1', '2026-11-01', [pay('A', 'S1')], []).kind).toBe('paid');
    expect(paymentStatus('A', 'S1', '2026-12-01', [pay('A', 'S1')], []).kind).toBe('unpaid');
  });

  it('AC3: unpaid courses in their period, sorted by title, names sorted; null when none is in its period', () => {
    const getUser = (id: string) => allUsers.find((u) => u.id === id);
    const getCourse = (id: string) => courses.find((c) => c.id === id);
    const base = { getCourse, members: courseMembers, getUser, payments: [], exemptions: [] };
    expect(unpaidThisMonth({ ...base, billing: [bill('C'), bill('B', 10, 15), bill('A')], now: NOV_3 })).toEqual([
      { courseId: 'A', title: 'Algebra', names: ['Abby Student', 'Student Sam', 'Student Sue'] },
      { courseId: 'C', title: 'Chemistry', names: ['Student Sue'] },
    ]);
    expect(unpaidThisMonth({ ...base, billing: [bill('B', 10, 15)], now: NOV_3 })).toBeNull();
    // A paid course the user can't read (hidden, ARU-40) isn't counted.
    expect(unpaidThisMonth({ ...base, billing: [bill('GONE')], now: NOV_3 })).toBeNull();
  });
});

describe('AC3 / AC6: "Unpaid this month" in the Accountant section', () => {
  it('an accountant sees only courses in their period with unpaid listeners, names sorted', async () => {
    setStore(
      forUser('M', {
        courseBilling: [bill('A'), bill('B', 10, 15), bill('C')],
        coursePayments: [pay('A', 'S1')],
        paymentExemptions: [{ courseId: 'C', userId: 'S2' }],
      }),
    );
    await render(<ProfileScreen />);
    const block = within(screen.getByTestId('unpaid-this-month'));
    expect(block.getByText('Unpaid this month')).toBeTruthy();
    expect(block.getByText('Algebra')).toBeTruthy();
    expect(block.getByText('Abby Student, Student Sue')).toBeTruthy();
    expect(block.queryByText('Biology')).toBeNull(); // not in its period
    expect(block.queryByText('Chemistry')).toBeNull(); // everyone there is exempt
    expect(block.queryByText('Everyone has paid')).toBeNull();
  });

  it('the teacher sees the same list', async () => {
    setStore(forUser('T', { courseBilling: [bill('C'), bill('A')] }));
    await render(<ProfileScreen />);
    const order = screen.getAllByTestId(/^unpaid-[A-Z]$/).map((n) => n.props.testID);
    expect(order).toEqual(['unpaid-A', 'unpaid-C']);
  });

  it('"Everyone has paid" when courses are in their period but nobody owes', async () => {
    setStore(
      forUser('M', {
        courseBilling: [bill('A')],
        coursePayments: [pay('A', 'S1'), pay('A', 'S2')],
        paymentExemptions: [{ courseId: 'A', userId: 'S3' }],
      }),
    );
    await render(<ProfileScreen />);
    expect(within(screen.getByTestId('unpaid-this-month')).getByText('Everyone has paid')).toBeTruthy();
  });

  it('AC2: next month everyone non-exempt is unpaid again', async () => {
    (Date.now as jest.Mock).mockReturnValue(new Date(2026, 11, 2, 9).getTime());
    setStore(forUser('M', { courseBilling: [bill('A')], coursePayments: [pay('A', 'S1'), pay('A', 'S2')], paymentExemptions: [{ courseId: 'A', userId: 'S3' }] }));
    await render(<ProfileScreen />);
    expect(screen.getByText('Student Sam, Student Sue')).toBeTruthy();
  });

  it('no block when no paid course is in its period', async () => {
    setStore(forUser('M', { courseBilling: [bill('B', 10, 15)] }));
    await render(<ProfileScreen />);
    expect(screen.queryByTestId('unpaid-this-month')).toBeNull();
  });

  it('the paid course row opens the payments screen', async () => {
    setStore(forUser('M', { courseBilling: [bill('A')] }));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Payments for Algebra' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/accountant/[id]', params: { id: 'A' } });
  });
});

describe('AC1 / AC6: the payments screen', () => {
  beforeEach(() => {
    params.id = 'A';
  });

  it('lists current listeners Unpaid, then Paid (date), then Exempt (ARU-124); Exempt wins', async () => {
    setStore(
      forUser('M', {
        courseBilling: [bill('A')],
        coursePayments: [pay('A', 'S1'), pay('A', 'S2', '2026-10-01'), pay('A', 'S3')],
        paymentExemptions: [{ courseId: 'A', userId: 'S3' }],
      }),
    );
    await render(<CoursePaymentsScreen />);
    const order = screen.getAllByTestId(/^payment-/).map((n) => n.props.testID);
    expect(order).toEqual(['payment-S2', 'payment-S1', 'payment-S3']);
    expect(within(screen.getByTestId('payment-S1')).getByText(`Paid · ${formatDate(new Date(2026, 10, 2, 12).toISOString())}`)).toBeTruthy();
    expect(within(screen.getByTestId('payment-S2')).getByText('Unpaid')).toBeTruthy(); // October's mark doesn't count
    expect(within(screen.getByTestId('payment-S3')).getByText('Exempt')).toBeTruthy();
  });

  it('marks Paid for the device-local month, undoes and sets / clears Exempt', async () => {
    const store = forUser('T', {
      courseBilling: [bill('A')],
      coursePayments: [pay('A', 'S1')],
      paymentExemptions: [{ courseId: 'A', userId: 'S3' }],
    });
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark Student Sue paid' }));
    await waitFor(() => expect(store.markPaid).toHaveBeenCalledWith('A', 'S2', '2026-11-01'));
    // ARU-118 AC 5: Undo paid now asks first; confirm it.
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    await fireEvent.press(screen.getByRole('button', { name: 'Undo paid for Student Sam' }));
    await waitFor(() => expect(store.undoPaid).toHaveBeenCalledWith('A', 'S1', '2026-11-01'));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear exempt for Abby Student' }));
    await waitFor(() => expect(store.setExempt).toHaveBeenCalledWith('A', 'S3', false));
    await fireEvent.press(screen.getByRole('button', { name: 'Set Student Sue exempt' }));
    await waitFor(() => expect(store.setExempt).toHaveBeenCalledWith('A', 'S2', true));
  });

  it('a failed mark shows the error and nothing changes', async () => {
    const markPaid = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    setStore(forUser('M', { courseBilling: [bill('A')], markPaid }));
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark Student Sue paid' }));
    await waitFor(() => expect(screen.getByText('Network request failed')).toBeTruthy());
    expect(within(screen.getByTestId('payment-S2')).getByText('Unpaid')).toBeTruthy();
  });

  it.each(['N', 'S1'] as const)('AC4: %s (not an accountant) sees no payments', async (who) => {
    setStore(forUser(who, { courseBilling: [bill('A')], coursePayments: [pay('A', 'S1')] }));
    await render(<CoursePaymentsScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByText(/Paid|Exempt/)).toBeNull();
  });

  it('a course that is no longer paid shows a message', async () => {
    setStore(forUser('M', { courseBilling: [] }));
    await render(<CoursePaymentsScreen />);
    expect(screen.getByText('Not a paid course')).toBeTruthy();
  });
});

// ARU-161: listeners no longer see payment deadlines (ARU-66 AC 7-9's card line and red border are gone).
describe('ARU-161: no payment deadline on the listener\'s Courses tab', () => {
  it('an unpaid listener in the period sees no border and no "Payment due" line; nothing is loaded', async () => {
    const loadPaymentDues = jest.fn(async () => [{ courseId: 'A', deadline: '2026-11-05' }]);
    setStore(forUser('S1', { loadPaymentDues }));
    await render(<CoursesScreen />);
    await act(async () => {});
    expect(screen.getByText('Algebra')).toBeTruthy();
    expect(screen.queryByTestId('payment-due-A')).toBeNull();
    expect(screen.queryByText(/Payment due|Payment overdue/)).toBeNull();
    expect(screen.queryByText(/^(Paid|Exempt|Unpaid)/)).toBeNull();
    // AC 7: no request on focus or when the app comes back.
    await refocus();
    await act(async () => AppState.currentState);
    expect(loadPaymentDues).not.toHaveBeenCalled();
  });
});
