// QA ARU-99: UI gaps in aru99-payment-requests.test.tsx: Exempt hides a waiting request and Clear exempt shows it
// again (AC 10); a removed listener's request disappears from the payments page (edge); once the requester is
// marked Paid they also leave "Unpaid this month" and the course row loses its badge (AC 10 / AC 6); a long course
// title keeps the badge and the ">" on the row (edge).
import { render, screen, within } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import CoursePaymentsScreen from '@/app/accountant/[id]';
import { localMonth } from '@/lib/billing';
import type { Course, CourseBilling, PaymentRequest, User } from '@/lib/types';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const month = localMonth();
const accountantN: User = { ...users.N, isAccountant: true };
const all = Object.values({ ...users, N: accountantN });
const billing: CourseBilling = { courseId: 'A', startDay: 1, endDay: 28, selectedById: 'N', selectedAt: '2026-11-01T10:00:00.000Z' };
const req = (userId: string): PaymentRequest => ({
  id: `r-${userId}`,
  courseId: 'A',
  userId,
  month,
  proofPath: `${userId}/p.jpg`,
  proofType: 'image',
  sentAt: '2026-11-02T10:00:00.000Z',
});
const staff = (over = {}) => {
  const base = fakeStore('N', {
    courses: [courseA],
    courseMembers: [member('A', 'S1'), member('A', 'S2')],
    courseBilling: [billing],
    paymentRequests: [req('S1')],
    ...over,
  });
  return { ...base, currentUser: accountantN, users: all, getUser: (id?: string) => all.find((u) => u.id === id) };
};
const paid = { courseId: 'A', userId: 'S1', month, markedById: 'N', markedAt: '2026-11-03T10:00:00.000Z' };

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

it('AC 10: Exempt hides the waiting request; Clear exempt shows it again', async () => {
  setStore(staff({ paymentExemptions: [{ courseId: 'A', userId: 'S1' }] }));
  const view = await render(<CoursePaymentsScreen />);
  expect(screen.queryByTestId('request-S1')).toBeNull();
  setStore(staff());
  await view.rerender(<CoursePaymentsScreen />);
  expect(screen.getByTestId('request-S1')).toBeTruthy();
});

it('edge: a removed listener\'s request disappears from the payments page', async () => {
  setStore(staff());
  const view = await render(<CoursePaymentsScreen />);
  expect(screen.getByTestId('request-S1')).toBeTruthy();
  setStore(staff({ courseMembers: [member('A', 'S2')] }));
  await view.rerender(<CoursePaymentsScreen />);
  expect(screen.queryByTestId('request-S1')).toBeNull();
  expect(screen.queryByTestId('payment-S1')).toBeNull();
});

it('AC 10 / AC 6: once Paid, the requester leaves "Unpaid this month" and the row loses its badge', async () => {
  setStore(staff());
  const view = await render(<ProfileScreen />);
  expect(within(screen.getByTestId('unpaid-A')).getByText(/Student Sam/)).toBeTruthy();
  expect(screen.getByTestId('requests-A')).toBeTruthy();
  setStore(staff({ coursePayments: [paid] }));
  await view.rerender(<ProfileScreen />);
  expect(within(screen.getByTestId('unpaid-A')).queryByText(/Student Sam/)).toBeNull();
  expect(screen.queryByTestId('requests-A')).toBeNull();
});

it('edge: a long course title keeps the request badge and the chevron on the row', async () => {
  const long: Course = { ...courseA, title: 'Advanced '.repeat(12).trim() };
  setStore(staff({ courses: [long] }));
  await render(<ProfileScreen />);
  const row = screen.getByRole('button', { name: `${long.title}, 1 payment request` });
  expect(within(row).getByTestId('requests-A')).toBeTruthy();
  expect(within(row).getByTestId('icon-chevron-forward', { includeHiddenElements: true })).toBeTruthy();
});
