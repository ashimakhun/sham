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

describe('Courses tab card', () => {
  it('AC 1 / AC 2: an overdue course keeps the red line, now "Payment overdue", in the card', async () => {
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => [overdueRow]) }));
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByTestId('payment-due-A')).toBeTruthy());
    expect(screen.getByText(`Payment overdue: was due ${nov5}`)).toBeTruthy();
    expect(screen.queryByText(/Payment due by/)).toBeNull();
  });

  it('AC 3: a due row (in the period) still reads "Payment due by"', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 3, 10).getTime());
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        loadPaymentDues: jest.fn(async () => [{ courseId: 'A', deadline: '2026-11-05', overdue: false }]),
      }),
    );
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByText(`Payment due by ${nov5}`)).toBeTruthy());
  });

  it('AC 7: marked Paid elsewhere: the overdue line goes on the next focus', async () => {
    let rows = [overdueRow];
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => rows) }));
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByTestId('payment-due-A')).toBeTruthy());
    rows = [];
    await refocus();
    await waitFor(() => expect(screen.queryByTestId('payment-due-A')).toBeNull());
  });

  it('AC 5 / AC 6: the line turns overdue past the deadline, and goes when the month ends', async () => {
    jest.restoreAllMocks();
    jest.useFakeTimers({
      now: new Date(2026, 10, 5, 23, 59, 50),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    try {
      // The server answers like 0061: due on the 5th, overdue later in November, nothing on 1 Dec.
      const loadPaymentDues = jest.fn(async (today: string) => {
        if (today === '2026-11-05') return [{ courseId: 'A', deadline: '2026-11-05', overdue: false }];
        if (today.startsWith('2026-11')) return [overdueRow];
        return [];
      });
      setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues }));
      await render(<CoursesScreen />);
      await act(async () => {});
      expect(screen.getByText(`Payment due by ${nov5}`)).toBeTruthy();
      // Midnight: the card switches without losing the line (and so the border).
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      await act(async () => {});
      expect(loadPaymentDues).toHaveBeenLastCalledWith('2026-11-06');
      expect(screen.getByText(`Payment overdue: was due ${nov5}`)).toBeTruthy();

      // 30 Nov 23:59:50 → 1 Dec: the highlight disappears.
      jest.setSystemTime(new Date(2026, 10, 30, 23, 59, 50));
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      await act(async () => {});
      expect(loadPaymentDues).toHaveBeenLastCalledWith('2026-12-01');
      expect(screen.queryByTestId('payment-due-A')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('course details', () => {
  it('AC 8: an overdue listener still sees Pay', async () => {
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => [overdueRow]) }));
    await render(<CourseDetailScreen />);
    expect(await screen.findByRole('button', { name: 'Pay' })).toBeTruthy();
  });
});
