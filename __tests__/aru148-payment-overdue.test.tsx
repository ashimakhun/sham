// ARU-148: an unpaid course stays highlighted after the payment period (overdue) until Paid / Exempt or the month
// ends. Rules are tested in supabase/tests/aru148_payment_overdue.test.sql. Course A (paid, days 1-5) has listener
// S1. The device date is 10 Nov 2026 unless a test changes it.
import { act, render, screen, waitFor } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import { paymentDueText, paymentOverdueText } from '@/lib/billing';
import { formatDate } from '@/lib/theme';
import { translate } from '@/i18n';

import { fakeStore, member } from './helpers/fakeStore';
import { params, refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const NOV_10 = new Date(2026, 10, 10, 10, 0).getTime();
const nov5 = formatDate(new Date(2026, 10, 5).toISOString());
const members = [member('A', 'S1')];
const overdueRow = { courseId: 'A', deadline: '2026-11-05', overdue: true };

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  jest.spyOn(Date, 'now').mockReturnValue(NOV_10);
});
afterEach(() => jest.restoreAllMocks());

describe('texts', () => {
  it('AC 1: the overdue line in English and Russian, with the deadline formatted like "Payment due by"', () => {
    expect(paymentOverdueText('2026-11-05', 'en')).toBe(`Payment overdue: was due ${nov5}`);
    expect(paymentOverdueText('2026-11-05', 'ru')).toBe(
      translate('ru', 'courses.paymentOverdue', { date: nov5 }),
    );
    expect(translate('ru', 'courses.paymentOverdue', { date: 'X' })).toBe('Оплата просрочена: срок был до X');
    expect(paymentDueText('2026-11-05', 'en')).toBe(`Payment due by ${nov5}`);
  });
});

// ARU-161: listeners no longer see the due or overdue line, its border or Pay (the texts above stay in the catalog).
describe('ARU-161: nothing for an overdue listener', () => {
  it('Courses tab: no overdue line or border, and no dues loaded', async () => {
    const loadPaymentDues = jest.fn(async () => [overdueRow]);
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues }));
    await render(<CoursesScreen />);
    await act(async () => {});
    expect(screen.getByText('Algebra')).toBeTruthy();
    expect(screen.queryByTestId('payment-due-A')).toBeNull();
    expect(screen.queryByText(/Payment overdue|Payment due by/)).toBeNull();
    await refocus();
    expect(loadPaymentDues).not.toHaveBeenCalled();
  });

  it('course details: no Pay', async () => {
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => [overdueRow]) }));
    await render(<CourseDetailScreen />);
    await screen.findByText('Algebra');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull());
  });
});
