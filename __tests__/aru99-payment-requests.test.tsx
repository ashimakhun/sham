// ARU-99: payment requests (UI side). Rules are tested in supabase/tests/aru99_payment_requests.test.sql and the
// store in aru99-store-payment-requests.test.tsx. A is a paid course (owner M) with listeners S1 and S2; N is an
// accountant; T the teacher.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
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
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const docs = DocumentPicker as jest.Mocked<typeof DocumentPicker>;

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

describe('listener: Pay on course details (AC 1, 3, 4)', () => {
  it('AC 1: an unpaid listener in the period sees Pay; it opens the Pay screen', async () => {
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: due() }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/pay', params: { id: 'A' } });
  });

  it('AC 1 / AC 4: not due (outside the period, Paid, Exempt or not a paid course): no Pay', async () => {
    const loadMyPaymentRequest = jest.fn(async () => null);
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: jest.fn(async () => []), loadMyPaymentRequest }));
    await render(<CourseDetailScreen />);
    await waitFor(() => expect(loadMyPaymentRequest).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
    expect(screen.queryByTestId('payment-request-sent')).toBeNull();
  });

  it('AC 3: with a request this month: when it was sent, waiting, and Send again (no Pay)', async () => {
    const loadMyPaymentRequest = jest.fn(async () => req('S1'));
    setStore(fakeStore('S1', { courseMembers: members, loadPaymentDues: due(), loadMyPaymentRequest }));
    await render(<CourseDetailScreen />);
    expect(
      await screen.findByText(`Payment request sent ${formatDate('2026-11-02T10:00:00.000Z')} · waiting for the accountant`),
    ).toBeTruthy();
    expect(loadMyPaymentRequest).toHaveBeenCalledWith('A', month);
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Send again' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/pay', params: { id: 'A' } });
  });

  it('AC 3: a request but no longer due (period over or marked Paid): neither line nor Pay', async () => {
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        loadPaymentDues: jest.fn(async () => []),
        loadMyPaymentRequest: jest.fn(async () => req('S1')),
      }),
    );
    await render(<CourseDetailScreen />);
    await waitFor(() => expect(screen.queryByTestId('payment-request-sent')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
  });
});

describe('listener: the Pay screen (AC 2)', () => {
  it('Send is disabled until a proof is attached; a photo shows a thumbnail and is sent for this month', async () => {
    const store = fakeStore('S1', { courseMembers: members });
    setStore(store);
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///p.jpg', width: 1, height: 1, mimeType: 'image/jpeg', fileSize: 1000, fileName: 'p.jpg' }],
    } as never);
    await render(<PayScreen />);
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    expect(await screen.findByTestId('proof-thumbnail')).toBeTruthy();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], preferredAssetRepresentationMode: 'compatible' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(store.sendPaymentRequest).toHaveBeenCalledWith('A', month, expect.objectContaining({ uri: 'file:///p.jpg', kind: 'image' })),
    );
    expect(router.back).toHaveBeenCalled();
  });

  it('a PDF shows its file name; it can be removed again', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    docs.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///r.pdf', name: 'receipt.pdf', mimeType: 'application/pdf', size: 2000 }],
    } as never);
    await render(<PayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a PDF' }));
    expect(await screen.findByText('receipt.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace PDF' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove proof' }));
    expect(screen.queryByText('receipt.pdf')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
  });

  it('a file over 10 MB shows the rule and nothing is attached', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    docs.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 }],
    } as never);
    await render(<PayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a PDF' }));
    expect(await screen.findByText('The proof must be a photo or a PDF up to 10 MB.')).toBeTruthy();
    expect(screen.queryByTestId('proof-preview')).toBeNull();
  });

  it('edge: photo access denied explains Settings; the PDF option still works', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
    await render(<PayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    expect(await screen.findByText(/Allow it in Settings, or attach a PDF instead/)).toBeTruthy();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Attach a PDF' })).toBeEnabled();
  });

  it('edge: a failed send shows the error and keeps the proof', async () => {
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        sendPaymentRequest: jest.fn(async () => {
          throw new Error('Network request failed');
        }),
      }),
    );
    docs.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///r.pdf', name: 'receipt.pdf', mimeType: 'application/pdf', size: 2000 }],
    } as never);
    await render(<PayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a PDF' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByText('receipt.pdf')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('someone who isn\'t a listener gets "Not allowed"', async () => {
    setStore(fakeStore('S3', { courseMembers: members }));
    await render(<PayScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
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
