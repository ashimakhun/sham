// ARU-161: listeners see no Pay, no payment request and no payment deadline anywhere (iOS, Android and web); the
// accountant side is unchanged. Mentor M is an accountant and a listener of course B (owned by N); course B is paid
// and in its period (1-28). S1 is an unpaid listener of B. The device date is 3 Nov 2026.
import { act, render, screen, within } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import ProfileScreen from '@/app/(tabs)/profile';
import CourseDetailScreen from '@/app/courses/[id]';
import en from '@/i18n/en.json';
import type { CourseBilling, User } from '@/lib/types';

import { courseA, courseB, fakeStore, member, users } from './helpers/fakeStore';
import { params, refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const accountantM: User = { ...users.M, isAccountant: true };
const allUsers = Object.values({ ...users, M: accountantM });
const bill: CourseBilling = { courseId: 'B', startDay: 1, endDay: 28, selectedById: 'M', selectedAt: '2026-11-01T10:00:00.000Z' };
const courseMembers = [member('B', 'M'), member('B', 'S1')];
const owes = () => jest.fn(async () => [{ courseId: 'B', deadline: '2026-11-28' }]);
const forUser = (who: 'M' | 'S1', over = {}) => {
  const base = fakeStore(who, { courses: [courseB, courseA], courseMembers, courseBilling: [bill], ...over });
  const me = who === 'M' ? accountantM : users[who];
  return { ...base, currentUser: me, users: allUsers, getUser: (id?: string) => allUsers.find((u) => u.id === id) };
};
// Every listener-side payment text, in English (AC 5, AC 10).
const PAYMENT_TEXT = /Pay\b|Payment due|Payment overdue|Payment request|Send again|waiting for the accountant/;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 3, 10).getTime());
  params.id = 'B';
});
afterEach(() => jest.restoreAllMocks());

it.each(['S1', 'M'] as const)('AC 4 / 7 / 9: %s (owes B) sees a plain card for B, and no dues are loaded', async (who) => {
  const loadPaymentDues = owes();
  setStore(forUser(who, { loadPaymentDues }));
  await render(<CoursesScreen />);
  await act(async () => {});
  expect(screen.getByText('Biology')).toBeTruthy();
  expect(screen.queryByTestId('payment-due-B')).toBeNull();
  expect(screen.queryByText(PAYMENT_TEXT)).toBeNull();
  await refocus();
  expect(loadPaymentDues).not.toHaveBeenCalled();
});

it.each(['S1', 'M'] as const)('AC 1 / 2 / 7 / 9: %s sees no Pay or request card on B', async (who) => {
  const loadMyPaymentRequest = jest.fn(async () => null);
  setStore(forUser(who, { loadPaymentDues: owes(), loadMyPaymentRequest }));
  await render(<CourseDetailScreen />);
  await screen.findByText('Biology');
  expect(screen.queryByText(PAYMENT_TEXT)).toBeNull();
  expect(screen.queryByTestId('payment-request-sent')).toBeNull();
  expect(loadMyPaymentRequest).not.toHaveBeenCalled();
});

it('AC 9: the mentor-accountant still has B in the Accountant section', async () => {
  setStore(forUser('M'));
  await render(<ProfileScreen />);
  const block = within(screen.getByTestId('unpaid-this-month'));
  expect(block.getByText('Biology')).toBeTruthy();
});

it('AC 10: no db.* text was removed', () => {
  expect(Object.keys(en).filter((k) => k.startsWith('db.')).length).toBeGreaterThanOrEqual(80);
});
