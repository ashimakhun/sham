// QA ARU-148, rewritten for ARU-161: listeners no longer see a due or overdue line, a red border, Pay or the
// "Payment request sent" card (App Store 3.1.1 / 3.1.3(d)). These tests keep ARU-148's situations (overdue, in
// Russian, at midnight, on the 1st, back from the background, a waiting request) and check that none of them shows
// anything about paying, and that the listener's dues and own request are never loaded. Course A (paid, days 1-5), S1.
import { act, render, screen } from '@testing-library/react-native';
import { AppState, StyleSheet } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import { setCurrentLanguage } from '@/i18n';
import { I18nContext, make } from '@/i18n/context';
import { colors } from '@/lib/theme';
import type { PaymentDue, PaymentRequest } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const NOV_10 = new Date(2026, 10, 10, 10, 0).getTime();
const members = [member('A', 'S1')];
const overdueRow: PaymentDue = { courseId: 'A', deadline: '2026-11-05', overdue: true };
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const PAYMENT_TEXT = /pay|payment|оплат|просроч/i;

function borderOf(node: { props: { style?: unknown }; parent: unknown } | null) {
  let n = node as { props: { style?: unknown }; parent: unknown } | null;
  while (n) {
    const s = StyleSheet.flatten(n.props.style as never) as { borderWidth?: number; borderColor?: string } | undefined;
    if (s?.borderWidth) return s;
    n = n.parent as typeof n;
  }
  return null;
}

/** Every string rendered on screen (hidden ones too), to look for payment wording. */
function allText(): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object' && 'children' in n) walk((n as { children: unknown }).children);
  };
  walk(screen.toJSON());
  return out.join(' | ');
}

const noPaymentOnCard = () => {
  expect(screen.getByText(courseA.title)).toBeTruthy();
  expect(screen.queryByTestId('payment-due-A')).toBeNull();
  expect(borderOf(screen.getByText(courseA.title) as never)?.borderColor).not.toBe(colors.danger);
  expect(allText()).not.toMatch(PAYMENT_TEXT);
};

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  jest.spyOn(Date, 'now').mockReturnValue(NOV_10);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Courses tab card (ARU-161)', () => {
  it('an overdue course: no line, no red border, and my_payment_dues is never loaded', async () => {
    const loadPaymentDues = jest.fn(async () => [overdueRow]);
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues }));
    await render(<CoursesScreen />);
    await act(async () => {});
    noPaymentOnCard();
    expect(loadPaymentDues).not.toHaveBeenCalled();
  });

  it('in Russian: no «Оплатить до» / «Оплата просрочена» on the card', async () => {
    setCurrentLanguage('ru');
    try {
      setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => [overdueRow]) }));
      await render(ru(<CoursesScreen />));
      await act(async () => {});
      noPaymentOnCard();
    } finally {
      setCurrentLanguage('en');
    }
  });

  it('at midnight after the end day and on the 1st: nothing is reloaded and nothing appears', async () => {
    jest.restoreAllMocks();
    jest.useFakeTimers({ now: new Date(2026, 10, 30, 23, 59, 50), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const loadPaymentDues = jest.fn(async () => [overdueRow]);
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues }));
    await render(<CoursesScreen />);
    await act(async () => {});
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(loadPaymentDues).not.toHaveBeenCalled();
    noPaymentOnCard();
  });

  it('back from the background: no payment reload and no reminder', async () => {
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      listeners.push(cb as (s: string) => void);
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    const loadPaymentDues = jest.fn(async () => [overdueRow]);
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues }));
    await render(<CoursesScreen />);
    await act(async () => {
      for (const l of listeners) l('background');
      for (const l of listeners) l('active');
    });
    expect(loadPaymentDues).not.toHaveBeenCalled();
    noPaymentOnCard();
  });
});

describe('course details (ARU-161)', () => {
  const req: PaymentRequest = {
    id: 'r1',
    courseId: 'A',
    userId: 'S1',
    month: '2026-11-01',
    proofPath: 'S1/p.jpg',
    proofType: 'image',
    sentAt: new Date(2026, 10, 8, 12).toISOString(),
  };

  it('overdue with a request sent before the change: no "request sent" card, no Send again, no Pay; nothing loaded', async () => {
    const store = fakeStore('S1', {
      courseMembers: members,
      loadPaymentDues: jest.fn(async () => [overdueRow]),
      loadMyPaymentRequest: jest.fn(async () => req),
    });
    setStore(store);
    await render(<CourseDetailScreen />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
    expect(screen.queryByText(/^Payment request sent /)).toBeNull();
    expect(screen.queryByRole('button', { name: /Send again/ })).toBeNull();
    expect(store.loadMyPaymentRequest).not.toHaveBeenCalled();
    expect(store.loadPaymentDues).not.toHaveBeenCalled();
    expect(allText()).not.toMatch(PAYMENT_TEXT);
  });

  it('in Russian: no «Оплатить», no «Запрос на оплату отправлен»', async () => {
    setCurrentLanguage('ru');
    try {
      setStore(
        fakeStore('S1', {
          courseMembers: members,
          loadPaymentDues: jest.fn(async () => [overdueRow]),
          loadMyPaymentRequest: jest.fn(async () => req),
        }),
      );
      await render(ru(<CourseDetailScreen />));
      await act(async () => {});
      expect(allText()).not.toMatch(PAYMENT_TEXT);
    } finally {
      setCurrentLanguage('en');
    }
  });
});
