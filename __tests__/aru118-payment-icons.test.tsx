// ARU-118: course payments: a green check mark marks Paid, a red X undoes Paid after a confirmation, the status is
// a badge, and View proof + Set / Clear exempt share one links row (Set exempt only for Unpaid listeners).
// A is a paid course with listeners S1 (Student Sam), S2 (Student Sue) and S3 (Abby Student). N is an accountant.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import CoursePaymentsScreen from '@/app/accountant/[id]';
import { localMonth } from '@/lib/billing';
import { colors, formatDate } from '@/lib/theme';
import type { CourseBilling, CoursePayment, PaymentRequest, User } from '@/lib/types';

import { fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const month = localMonth();
const accountantN: User = { ...users.N, isAccountant: true };
const all = Object.values({ ...users, N: accountantN });
const billing: CourseBilling = { courseId: 'A', startDay: 1, endDay: 28, selectedById: 'N', selectedAt: '2026-11-01T10:00:00.000Z' };
const markedAt = '2026-11-02T12:00:00.000Z';
const pay = (userId: string, m = month): CoursePayment => ({ courseId: 'A', userId, month: m, markedById: 'T', markedAt });
const req = (userId: string): PaymentRequest => ({
  id: `r-${userId}`,
  courseId: 'A',
  userId,
  month,
  proofPath: `${userId}/p.jpg`,
  proofType: 'image',
  sentAt: '2026-11-02T10:00:00.000Z',
});
const staff = (who: 'N' | 'T', over = {}) => {
  const base = fakeStore(who, {
    courseMembers: [member('A', 'S1'), member('A', 'S2'), member('A', 'S3')],
    courseBilling: [billing],
    ...over,
  });
  return { ...base, currentUser: who === 'N' ? accountantN : users.T, users: all, getUser: (id?: string) => all.find((u) => u.id === id) };
};
const row = (id: string) => within(screen.getByTestId(`payment-${id}`));
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
/** Answers the next native confirmation: true taps the confirm button, false Cancel. */
const answer = (ok: boolean) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[ok ? 1 : 0]?.onPress?.());

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  params.id = 'A';
});

describe('AC 1: status badges', () => {
  it('Unpaid, Paid (date) and Exempt as coloured badges', async () => {
    setStore(staff('N', { coursePayments: [pay('S1')], paymentExemptions: [{ courseId: 'A', userId: 'S3' }] }));
    await render(<CoursePaymentsScreen />);
    const badge = (id: string) => row(id).getByTestId('status-badge');
    const text = (id: string) => within(badge(id)).getByText(/.+/);
    expect(flat(badge('S2')).backgroundColor).toBe('#FEF2F2');
    expect(flat(text('S2')).color).toBe(colors.danger);
    expect(row('S2').getByText('Unpaid')).toBeTruthy();
    expect(row('S1').getByText(`Paid · ${formatDate(markedAt)}`)).toBeTruthy();
    expect(flat(badge('S1')).backgroundColor).toBe(colors.successSoft);
    expect(flat(text('S1')).color).toBe(colors.success);
    expect(row('S3').getByText('Exempt')).toBeTruthy();
    expect(flat(text('S3')).color).toBe(colors.muted);
    expect(flat(badge('S3')).backgroundColor).toBe(colors.mutedSoft);
    // The badge isn't a button.
    expect(screen.queryByRole('button', { name: /^Unpaid|^Paid|^Exempt/ })).toBeNull();
  });

  it("last month's Paid mark shows Unpaid", async () => {
    setStore(staff('N', { coursePayments: [pay('S1', '2020-01-01')] }));
    await render(<CoursePaymentsScreen />);
    expect(row('S1').getByText('Unpaid')).toBeTruthy();
    expect(row('S1').getByTestId('mark-paid-S1')).toBeTruthy();
  });
});

describe('AC 2-4, 6, 7: icons and links per status', () => {
  it('Unpaid: check mark, Set exempt, no text Mark paid; Paid: X only; Exempt: Clear exempt, no icon', async () => {
    setStore(staff('N', { coursePayments: [pay('S1')], paymentExemptions: [{ courseId: 'A', userId: 'S3' }] }));
    await render(<CoursePaymentsScreen />);
    // Unpaid
    const check = row('S2').getByTestId('mark-paid-S2');
    expect(flat(check)).toMatchObject({ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.successSoft });
    expect(check.props.hitSlop).toBe(4); // 36 + 2×4 = 44 pt (AC 10)
    expect(row('S2').queryByText('Mark paid')).toBeNull();
    expect(row('S2').getByRole('button', { name: 'Set Student Sue exempt' })).toBeTruthy();
    expect(row('S2').queryByTestId('undo-paid-S2')).toBeNull();
    // Paid
    const x = row('S1').getByTestId('undo-paid-S1');
    expect(flat(x)).toMatchObject({ width: 36, height: 36, backgroundColor: colors.dangerSoft });
    expect(row('S1').queryByText('Undo paid')).toBeNull();
    expect(row('S1').queryByRole('button', { name: 'Set Student Sam exempt' })).toBeNull();
    expect(row('S1').queryByTestId('mark-paid-S1')).toBeNull();
    // Exempt
    expect(row('S3').queryByTestId('mark-paid-S3')).toBeNull();
    expect(row('S3').queryByTestId('undo-paid-S3')).toBeNull();
    expect(row('S3').getByRole('button', { name: 'Clear exempt for Abby Student' })).toBeTruthy();
  });

  it('AC 9: screen reader labels', async () => {
    setStore(staff('T', { coursePayments: [pay('S1')] }));
    await render(<CoursePaymentsScreen />);
    expect(screen.getByRole('button', { name: 'Mark Student Sue paid' }).props.testID).toBe('mark-paid-S2');
    expect(screen.getByRole('button', { name: 'Undo paid for Student Sam' }).props.testID).toBe('undo-paid-S1');
  });

  it('AC 7: a waiting request shows its line, then View proof and Set exempt on the same links row', async () => {
    setStore(staff('N', { paymentRequests: [req('S2')] }));
    await render(<CoursePaymentsScreen />);
    expect(row('S2').getByTestId('request-S2')).toBeTruthy();
    const proof = row('S2').getByRole('button', { name: 'View payment proof from Student Sue' });
    const exempt = row('S2').getByRole('button', { name: 'Set Student Sue exempt' });
    expect(proof.parent?.parent).toBe(exempt.parent?.parent);
    // Listener with the request is first (AC 11).
    expect(screen.getAllByTestId(/^payment-S/)[0].props.testID).toBe('payment-S2');
  });
});

describe('AC 3 / AC 5: actions', () => {
  it('the check mark marks Paid at once, without a confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const store = staff('N');
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByTestId('mark-paid-S2'));
    await waitFor(() => expect(store.markPaid).toHaveBeenCalledWith('A', 'S2', month));
    expect(store.markPaid).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it('the X asks "Undo paid"; Cancel changes nothing', async () => {
    const alert = answer(false);
    const store = staff('N', { coursePayments: [pay('S1')] });
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByTestId('undo-paid-S1'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Undo paid');
    expect(message).toBe('Undo paid for Student Sam for this month? They will show as Unpaid.');
    expect(buttons?.map((b) => b.text)).toEqual(['Cancel', 'Undo paid']);
    expect(buttons?.[1].style).toBe('destructive');
    await act(async () => {});
    expect(store.undoPaid).not.toHaveBeenCalled();
    // Not left busy after Cancel.
    expect(screen.getByTestId('undo-paid-S1').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('confirming undoes Paid', async () => {
    answer(true);
    const store = staff('N', { coursePayments: [pay('S1')] });
    setStore(store);
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByTestId('undo-paid-S1'));
    await waitFor(() => expect(store.undoPaid).toHaveBeenCalledWith('A', 'S1', month));
    expect(store.undoPaid).toHaveBeenCalledTimes(1);
  });

  it('a failed undo shows the error under the row; the status stays', async () => {
    answer(true);
    const undoPaid = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    setStore(staff('N', { coursePayments: [pay('S1')], undoPaid }));
    await render(<CoursePaymentsScreen />);
    await fireEvent.press(screen.getByTestId('undo-paid-S1'));
    await waitFor(() => expect(row('S1').getByText('Network request failed')).toBeTruthy());
    expect(row('S1').getByText(`Paid · ${formatDate(markedAt)}`)).toBeTruthy();
  });
});

describe('AC 8: busy', () => {
  it('while marking, the icon and Set exempt are dimmed and disabled; a second tap does nothing', async () => {
    let finish: () => void = () => {};
    const markPaid = jest.fn(() => new Promise<void>((r) => (finish = r)));
    setStore(staff('N', { markPaid }));
    await render(<CoursePaymentsScreen />);
    void fireEvent.press(screen.getByTestId('mark-paid-S2'));
    await waitFor(() => expect(screen.getByTestId('mark-paid-S2').props.accessibilityState).toMatchObject({ disabled: true }));
    const icon = screen.getByTestId('mark-paid-S2');
    expect(flat(icon).opacity).toBe(0.4);
    const exempt = row('S2').getByRole('button', { name: 'Set Student Sue exempt' });
    expect(exempt.props.accessibilityState).toMatchObject({ disabled: true });
    expect(flat(within(exempt).getByText('Set exempt')).opacity).toBe(0.4);
    void fireEvent.press(icon);
    await act(async () => {});
    expect(markPaid).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByTestId('mark-paid-S2').props.accessibilityState).toMatchObject({ disabled: false });
  });
});
