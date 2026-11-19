// QA ARU-161: gaps in aru161-hide-listener-payments.test.tsx: the old Pay address (AC 3) for the teacher, an
// accountant and a listener, and with no course id; Russian on every listener screen (AC 5); the accountant still sees
// a request sent before the change, with View proof, and can mark Paid (AC 8); and no Pay route leads anywhere.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import HomeworkScreen from '@/app/(tabs)/homework';
import ProfileScreen from '@/app/(tabs)/profile';
import CoursePaymentsScreen from '@/app/accountant/[id]';
import CourseDetailScreen from '@/app/courses/[id]';
import PayScreen from '@/app/courses/[id]/pay';
import { setCurrentLanguage } from '@/i18n';
import { I18nContext, make } from '@/i18n/context';
import type { CourseBilling, PaymentRequest, User } from '@/lib/types';

import { courseA, courseB, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const NOV_10 = new Date(2026, 10, 10, 10).getTime();
const accountantM: User = { ...users.M, isAccountant: true };
const allUsers = Object.values({ ...users, M: accountantM });
const bill: CourseBilling = { courseId: 'B', startDay: 1, endDay: 5, selectedById: 'M', selectedAt: '2026-11-01T10:00:00.000Z' };
const courseMembers = [member('B', 'M'), member('B', 'S1')];
const request: PaymentRequest = {
  id: 'r1',
  courseId: 'B',
  userId: 'S1',
  month: '2026-11-01',
  proofPath: 'S1/proof.jpg',
  proofType: 'image',
  sentAt: new Date(2026, 10, 3, 12).toISOString(),
};
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const forUser = (who: 'T' | 'M' | 'S1', over = {}) => {
  const base = fakeStore(who, {
    courses: [courseB, courseA],
    courseMembers,
    courseBilling: [bill],
    paymentRequests: [request],
    loadPaymentDues: jest.fn(async () => [{ courseId: 'B', deadline: '2026-11-05', overdue: true }]),
    loadMyPaymentRequest: jest.fn(async () => request),
    ...over,
  });
  const me = who === 'M' ? accountantM : users[who];
  return { ...base, currentUser: me, users: allUsers, getUser: (id?: string) => allUsers.find((u) => u.id === id) };
};
const redirect = () => jest.requireMock('expo-router').Redirect as jest.Mock;

/** Every string rendered on screen, to look for payment wording. */
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOV_10);
  params.id = 'B';
});
afterEach(() => jest.restoreAllMocks());

describe('AC 3: the old Pay address', () => {
  it.each(['S1', 'M', 'T'] as const)('%s is sent to the course, with no form, picker or payment text', async (who) => {
    setStore(forUser(who));
    await render(<PayScreen />);
    expect(screen.toJSON()).toBeNull();
    const calls = redirect().mock.calls as unknown as [{ href: unknown }][];
    expect(calls[calls.length - 1][0]).toEqual({ href: { pathname: '/courses/[id]', params: { id: 'B' } } });
  });

  it('with no course id it goes to the Courses tab and does not crash', async () => {
    params.id = undefined as unknown as string;
    setStore(forUser('S1'));
    await render(<PayScreen />);
    const calls = redirect().mock.calls as unknown as [{ href: unknown }][];
    expect(calls[calls.length - 1][0]).toEqual({ href: '/courses' });
  });
});

describe('AC 5: no payment text for an owing listener, in Russian', () => {
  const PAYMENT_RU = /оплат|просроч|запрос на оплату|отправить снова/i;
  it.each([
    ['Courses', () => <CoursesScreen />],
    ['course details', () => <CourseDetailScreen />],
    ['Homework', () => <HomeworkScreen />],
    ['Profile', () => <ProfileScreen />],
  ] as const)('%s', async (_name, ui) => {
    setCurrentLanguage('ru');
    try {
      setStore(forUser('S1'));
      await render(ru(ui()));
      await act(async () => {});
      expect(allText()).not.toMatch(PAYMENT_RU);
    } finally {
      setCurrentLanguage('en');
    }
  });
});

describe('AC 8: the accountant side is unchanged', () => {
  it('a request sent before the change is still listed with View proof, and Mark paid still works', async () => {
    const store = forUser('M');
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await act(async () => {});
    expect(screen.getByTestId('request-S1')).toBeTruthy();
    expect(screen.getByRole('button', { name: `View payment proof from ${users.S1.name}` })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('mark-paid-S1'));
    await act(async () => {});
    expect(store.markPaid).toHaveBeenCalledWith('B', 'S1', '2026-11-01');
  });
});
