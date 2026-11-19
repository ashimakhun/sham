// ARU-99: payment requests (UI side). Rules are tested in supabase/tests/aru99_payment_requests.test.sql and the
// store in aru99-store-payment-requests.test.tsx. A is a paid course (owner M) with listeners S1 and S2; N is an
// accountant; T the teacher.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import CoursePaymentsScreen from '@/app/accountant/[id]';
import CourseDetailScreen from '@/app/courses/[id]';
import PayScreen from '@/app/courses/[id]/pay';
import { localMonth, requestCountText, waitingRequests } from '@/lib/billing';
import { isAllowedProof, proofFileName } from '@/lib/paymentProof';
import { formatDate } from '@/lib/theme';
import type { CourseBilling, PaymentRequest, User } from '@/lib/types';

import { courseA, courseB, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const month = localMonth();
const accountantN: User = { ...users.N, isAccountant: true };
const all = Object.values({ ...users, N: accountantN });
const billing = (courseId: string): CourseBilling => ({
  courseId,
  startDay: 1,
  endDay: 28,
  selectedById: 'N',
  selectedAt: '2026-11-01T10:00:00.000Z',
});
const req = (userId: string, over: Partial<PaymentRequest> = {}): PaymentRequest => ({
  id: `r-${userId}`,
  courseId: 'A',
  userId,
  month,
  proofPath: `${userId}/p.jpg`,
  proofType: 'image',
  sentAt: '2026-11-02T10:00:00.000Z',
  ...over,
});
const members = [member('A', 'S1'), member('A', 'S2')];
const staff = (who: 'N' | 'T', over = {}) => {
  const base = fakeStore(who, { courseMembers: members, courseBilling: [billing('A')], ...over });
  return { ...base, currentUser: who === 'N' ? accountantN : users.T, users: all, getUser: (id?: string) => all.find((u) => u.id === id) };
};
const due = (courseId = 'A') => jest.fn(async () => [{ courseId, deadline: '2099-12-28' }]);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('helpers', () => {
  it('waiting = this month, current listener, unpaid (not Paid, not Exempt)', () => {
    const requests = [req('S1'), req('S2'), req('S3'), req('S1', { id: 'old', month: '2020-01-01' })];
    const base = { courseId: 'A', month, requests, members, payments: [], exemptions: [] };
    expect(waitingRequests(base).map((r) => r.id)).toEqual(['r-S1', 'r-S2']);
    const paid = [{ courseId: 'A', userId: 'S1', month, markedById: 'N', markedAt: 'x' }];
    expect(waitingRequests({ ...base, payments: paid }).map((r) => r.userId)).toEqual(['S2']);
    expect(waitingRequests({ ...base, exemptions: [{ courseId: 'A', userId: 'S2' }] }).map((r) => r.userId)).toEqual(['S1']);
    expect(requestCountText(1)).toBe('1 request');
    expect(requestCountText(2)).toBe('2 requests');
  });

  it('proof rules and the download name', () => {
    expect(isAllowedProof({ uri: 'x', kind: 'image', mimeType: 'image/jpeg', size: 10 * 1024 * 1024 })).toBe(true);
    expect(isAllowedProof({ uri: 'x', kind: 'image', size: 10 * 1024 * 1024 + 1 })).toBe(false);
    expect(isAllowedProof({ uri: 'x', kind: 'pdf', name: 'a.PDF' })).toBe(true);
    expect(isAllowedProof({ uri: 'x', kind: 'pdf', name: 'a.docx', mimeType: 'application/msword' })).toBe(false);
    expect(proofFileName('Algebra 1/2', 'Student Sam')).toBe('payment-proof-Algebra_1_2-Student_Sam.jpg');
  });
});

// ARU-161: the listener side of ARU-99 is gone on every platform: no Pay, no "request sent" card, and the old Pay
// address only redirects to the course. Nothing payment-related is loaded for the listener.
describe('listener: no Pay on course details (ARU-161 AC 1, 2, 7)', () => {
  it.each([
    ['due, no request', null],
    ['due, a request sent this month', 'sent'],
  ] as const)('%s: no Pay, no "request sent" card, no Send again', async (_what, sent) => {
    const loadPaymentDues = due();
    const loadMyPaymentRequest = jest.fn(async () => (sent ? req('S1') : null));
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues, loadMyPaymentRequest }));
    await render(<CourseDetailScreen />);
    await screen.findByText('Algebra');
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
    expect(screen.queryByTestId('payment-request-sent')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
    expect(screen.queryByText(/Payment request sent/)).toBeNull();
    // AC 7: neither the dues nor the own request is loaded.
    expect(loadPaymentDues).not.toHaveBeenCalled();
    expect(loadMyPaymentRequest).not.toHaveBeenCalled();
  });
});

describe('the old Pay address (ARU-161 AC 3)', () => {
  const { Redirect } = jest.requireMock('expo-router') as { Redirect: jest.Mock };
  it.each(['S1', 'M', 'T'] as const)('%s is sent to the course; no proof form, nothing sent', async (who) => {
    const store = fakeStore(who, { courseMembers: members });
    setStore(store);
    await render(<PayScreen />);
    expect(Redirect.mock.calls[0][0]).toEqual({ href: { pathname: '/courses/[id]', params: { id: 'A' } } });
    expect(screen.queryByRole('button', { name: /Send|Photo|PDF/ })).toBeNull();
    expect(store.sendPaymentRequest).not.toHaveBeenCalled();
  });

  it('no course id: to the Courses tab', async () => {
    const { Redirect: R } = jest.requireMock('expo-router') as { Redirect: jest.Mock };
    params.id = undefined;
    setStore(fakeStore('S1'));
    await render(<PayScreen />);
    expect(R.mock.calls[0][0]).toEqual({ href: '/courses' });
  });
});

describe('accountant: the Accountant section on Profile (AC 5, 6, 7)', () => {
  it('each paid course is a row with ">" opening its payments page; no period, Change period or Unselect', async () => {
    setStore(staff('N', { courseBilling: [billing('A'), billing('B')] }));
    await render(<ProfileScreen />);
    const row = within(screen.getByTestId('paid-A'));
    expect(row.getByTestId('icon-chevron-forward', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText(/^Pays /)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change period' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unselect' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Select courses' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Payments for Algebra' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/accountant/[id]', params: { id: 'A' } });
  });

  it('AC 6: the badge counts waiting requests only; screen readers hear the count', async () => {
    const paymentRequests = [req('S1'), req('S2'), req('S3'), req('S1', { id: 'old', month: '2020-01-01' })];
    setStore(staff('T', { paymentRequests, courses: [courseA, courseB] }));
    const view = await render(<ProfileScreen />);
    expect(within(screen.getByTestId('requests-A')).getByText('2 requests')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Algebra, 2 payment requests' })).toBeTruthy();
    // S1 marked Paid, S2 removed from the course: no waiting request, no badge.
    setStore(
      staff('T', {
        paymentRequests,
        courseMembers: [member('A', 'S1')],
        coursePayments: [{ courseId: 'A', userId: 'S1', month, markedById: 'N', markedAt: 'x' }],
      }),
    );
    await view.rerender(<ProfileScreen />);
    expect(screen.queryByTestId('requests-A')).toBeNull();
    expect(screen.getByRole('button', { name: 'Payments for Algebra' })).toBeTruthy();
  });
});

describe('accountant: the course payments page (AC 8-11)', () => {
  it('AC 8: the header has the period, Change period and (accountants) Unselect', async () => {
    setStore(staff('N'));
    await render(<CoursePaymentsScreen />);
    const header = within(screen.getByTestId('payments-header'));
    expect(header.getByText('Pays 1–28 of each month')).toBeTruthy();
    expect(header.getByRole('button', { name: 'Change period' })).toBeTruthy();
    expect(header.getByRole('button', { name: 'Unselect' })).toBeTruthy();
  });

  it('AC 9: requests under the name with View proof, listed first; other months aren\'t shown (AC 11)', async () => {
    setStore(staff('N', { paymentRequests: [req('S2'), req('S1', { month: '2020-01-01' })] }));
    await render(<CoursePaymentsScreen />);
    const order = screen.getAllByTestId(/^payment-S\d$/).map((r) => r.props.testID);
    expect(order).toEqual(['payment-S2', 'payment-S1']);
    expect(within(screen.getByTestId('payment-S2')).getByText(`Payment request · ${formatDate('2026-11-02T10:00:00.000Z')}`)).toBeTruthy();
    expect(screen.queryByTestId('request-S1')).toBeNull();
  });

  it('AC 9: a photo proof opens full-screen with Download named after course and listener', async () => {
    const store = staff('N', { paymentRequests: [req('S1')] });
    setStore(store);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'View payment proof from Student Sam' }));
    expect(await screen.findByTestId('photo-preview')).toBeTruthy();
    await waitFor(() => expect(store.getPaymentProofUrl).toHaveBeenCalledWith('S1/p.jpg'));
    await fireEvent.press(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(store.getPaymentProofUrl).toHaveBeenCalledWith('S1/p.jpg', {
        expiresIn: 60,
        download: 'payment-proof-Algebra-Student_Sam.jpg',
      }),
    );
    expect(open).toHaveBeenCalled();
  });

  it('AC 9: a PDF proof opens through a signed link; a missing file says "Couldn\'t load the proof"', async () => {
    const getPaymentProofUrl = jest
      .fn()
      .mockResolvedValueOnce('https://signed/pdf')
      .mockRejectedValueOnce(new Error('Object not found'));
    setStore(staff('T', { paymentRequests: [req('S1', { proofType: 'pdf', proofPath: 'S1/p.pdf' })], getPaymentProofUrl }));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'View payment proof from Student Sam' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed/pdf'));
    await fireEvent.press(screen.getByRole('button', { name: 'View payment proof from Student Sam' }));
    expect(await screen.findByText("Couldn't load the proof")).toBeTruthy();
  });

  it('AC 10: Mark paid on a listener with a request marks them; once Paid the request isn\'t shown', async () => {
    const store = staff('N', { paymentRequests: [req('S1')] });
    setStore(store);
    const view = await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark Student Sam paid' }));
    await waitFor(() => expect(store.markPaid).toHaveBeenCalledWith('A', 'S1', month));
    setStore(staff('N', { paymentRequests: [req('S1')], coursePayments: [{ courseId: 'A', userId: 'S1', month, markedById: 'N', markedAt: 'x' }] }));
    await view.rerender(<CoursePaymentsScreen />);
    expect(screen.queryByTestId('request-S1')).toBeNull();
    // Undo paid in the same month: it shows again.
    setStore(staff('N', { paymentRequests: [req('S1')] }));
    await view.rerender(<CoursePaymentsScreen />);
    expect(screen.getByTestId('request-S1')).toBeTruthy();
  });
});
