// QA ARU-148: gaps in aru148-payment-overdue.test.tsx: the overdue card keeps the 1 pt theme-red border, even at
// midnight before the reload answers (AC 5) and drops it at once on the 1st (AC 6); the Russian line on the card; a
// waiting request keeps the card overdue and shows "Payment request sent … · Send again" (AC 8 / AC 9); Pay goes on
// the 1st; Paid elsewhere clears on foreground (AC 7); a failed load shows nothing. Course A (paid, days 1-5), S1.
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, StyleSheet } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import { setCurrentLanguage } from '@/i18n';
import { I18nContext, make } from '@/i18n/context';
import { formatDay } from '@/lib/billing';
import { colors } from '@/lib/theme';
import type { PaymentDue, PaymentRequest } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const NOV_10 = new Date(2026, 10, 10, 10, 0).getTime();
const members = [member('A', 'S1')];
const overdueRow: PaymentDue = { courseId: 'A', deadline: '2026-11-05', overdue: true };
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const never = () => new Promise<PaymentDue[]>(() => {});

function borderOf(node: { props: { style?: unknown }; parent: unknown } | null) {
  let n = node as { props: { style?: unknown }; parent: unknown } | null;
  while (n) {
    const s = StyleSheet.flatten(n.props.style as never) as { borderWidth?: number; borderColor?: string } | undefined;
    if (s?.borderWidth) return s;
    n = n.parent as typeof n;
  }
  return null;
}
const redBorder = () => expect(borderOf(screen.getByTestId('payment-due-A') as never)).toEqual(
  expect.objectContaining({ borderWidth: 1, borderColor: colors.danger }),
);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  jest.spyOn(Date, 'now').mockReturnValue(NOV_10);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Courses tab card', () => {
  it('AC 1: the overdue card keeps the 1 pt theme-red border', async () => {
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => [overdueRow]) }));
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByTestId('payment-due-A')).toBeTruthy());
    redBorder();
  });

  it('AC 1 / AC 2: in Russian the card reads «Оплата просрочена: срок был до …» with a Russian date', async () => {
    // The app's I18n provider sets the app-wide language that dates use; the test context alone doesn't.
    setCurrentLanguage('ru');
    try {
      setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => [overdueRow]) }));
      await render(ru(<CoursesScreen />));
      await waitFor(() => expect(screen.getByTestId('payment-due-A')).toBeTruthy());
      const text = screen.getByTestId('payment-due-A').props.children as string;
      expect(text.startsWith('Оплата просрочена: срок был до ')).toBe(true);
      expect(text).not.toMatch(/[A-Za-z]/);
      expect(screen.getByTestId('payment-due-A').props.accessibilityLabel).toBeUndefined();
    } finally {
      setCurrentLanguage('en');
    }
  });

  it('AC 5: at midnight after the end day the card turns overdue at once, border kept, before the reload answers', async () => {
    jest.restoreAllMocks();
    jest.useFakeTimers({ now: new Date(2026, 10, 5, 23, 59, 50), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const loadPaymentDues = jest.fn((today: string) =>
      today === '2026-11-05' ? Promise.resolve([{ courseId: 'A', deadline: '2026-11-05', overdue: false }]) : never(),
    );
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues }));
    await render(<CoursesScreen />);
    await act(async () => {});
    expect(screen.getByTestId('payment-due-A').props.children).toBe(`Payment due by ${formatDay('2026-11-05')}`);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(loadPaymentDues).toHaveBeenLastCalledWith('2026-11-06');
    expect(screen.getByTestId('payment-due-A').props.children).toBe(`Payment overdue: was due ${formatDay('2026-11-05')}`);
    redBorder();
  });

  it('AC 6: on the 1st the overdue highlight goes at once, before the reload answers', async () => {
    jest.restoreAllMocks();
    jest.useFakeTimers({ now: new Date(2026, 10, 30, 23, 59, 50), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const loadPaymentDues = jest.fn((today: string) => (today === '2026-11-30' ? Promise.resolve([overdueRow]) : never()));
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues }));
    await render(<CoursesScreen />);
    await act(async () => {});
    expect(screen.getByTestId('payment-due-A')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(loadPaymentDues).toHaveBeenLastCalledWith('2026-12-01');
    expect(screen.queryByTestId('payment-due-A')).toBeNull();
  });

  it('AC 7: marked Paid elsewhere, the overdue line goes when the app returns to the foreground', async () => {
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      listeners.push(cb as (s: string) => void);
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    let rows = [overdueRow];
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => rows) }));
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByTestId('payment-due-A')).toBeTruthy());
    rows = [];
    await act(async () => {
      for (const l of listeners) l('active');
    });
    await waitFor(() => expect(screen.queryByTestId('payment-due-A')).toBeNull());
  });

  it('edge: a failed load shows no highlight and no error', async () => {
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => Promise.reject(new Error('x'))) }));
    await render(<CoursesScreen />);
    await act(async () => {});
    expect(screen.queryByTestId('payment-due-A')).toBeNull();
    expect(screen.queryByText(/x$/)).toBeNull();
  });
});

describe('course details', () => {
  it('AC 8 / AC 9: overdue with a waiting request: "Payment request sent … · Send again", and the card stays overdue', async () => {
    const req: PaymentRequest = {
      id: 'r1',
      courseId: 'A',
      userId: 'S1',
      month: '2026-11-01',
      proofPath: 'S1/p.jpg',
      proofType: 'image',
      sentAt: new Date(2026, 10, 8, 12).toISOString(),
    };
    const store = fakeStore('S1', {
      courseMembers: members,
      loadPaymentDues: jest.fn(async () => [overdueRow]),
      loadMyPaymentRequest: jest.fn(async () => req),
    });
    setStore(store);
    const view = await render(<CourseDetailScreen />);
    expect(await screen.findByText(/^Payment request sent /)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send again/ })).toBeTruthy();
    expect(store.loadMyPaymentRequest).toHaveBeenCalledWith('A', '2026-11-01');
    await view.unmount();
    await render(<CoursesScreen />);
    await waitFor(() => expect(screen.getByTestId('payment-due-A').props.children).toMatch(/^Payment overdue/));
  });

  it('AC 8: Pay goes on the 1st of the next month', async () => {
    jest.restoreAllMocks();
    jest.useFakeTimers({ now: new Date(2026, 10, 30, 23, 59, 50), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const loadPaymentDues = jest.fn(async (today: string) => (today.startsWith('2026-11') ? [overdueRow] : []));
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues }));
    await render(<CourseDetailScreen />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Pay' })).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
  });
});
