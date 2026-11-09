// ARU-124: the course payments page lists unpaid listeners with a request first, then unpaid, then paid, then exempt
// (A–Z within each group). The order is set when the screen gains focus and after pull to refresh, and doesn't move
// when a status changes in between. Device date: 3 Nov 2026.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import CoursePaymentsScreen from '@/app/accountant/[id]';
import { byPaymentRank, inFrozenOrder, paymentRank } from '@/lib/billing';
import type { CourseMember, CoursePayment, PaymentExemption, PaymentRequest, User } from '@/lib/types';

import { fakeStore, member, users } from './helpers/fakeStore';
import { params, refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const NOV_3 = new Date(2026, 10, 3, 10, 0).getTime();
const MONTH = '2026-11-01';
const accountantM: User = { ...users.M, isAccountant: true };
// Test-design names: Zed (request), Amy (unpaid), Bob (request), Cat (paid), Dan (exempt), Eve (paid and exempt).
const people: User[] = [
  { id: 'Z', name: 'Zed', role: 'student' },
  { id: 'A1', name: 'Amy', role: 'student' },
  { id: 'B', name: 'Bob', role: 'student' },
  { id: 'C', name: 'Cat', role: 'student' },
  { id: 'D', name: 'Dan', role: 'student' },
  { id: 'E', name: 'Eve', role: 'student' },
];
const all = [...Object.values({ ...users, M: accountantM }), ...people];
const pay = (userId: string, month = MONTH): CoursePayment => ({
  courseId: 'A',
  userId,
  month,
  markedById: 'M',
  markedAt: new Date(2026, 10, 2, 12).toISOString(),
});
const req = (userId: string): PaymentRequest => ({
  id: `r-${userId}`,
  courseId: 'A',
  userId,
  month: MONTH,
  proofPath: `${userId}/p.jpg`,
  proofType: 'image',
  sentAt: '2026-11-02T10:00:00.000Z',
});
const ex = (userId: string): PaymentExemption => ({ courseId: 'A', userId });

type Data = {
  courseMembers?: CourseMember[];
  coursePayments?: CoursePayment[];
  paymentExemptions?: PaymentExemption[];
  paymentRequests?: PaymentRequest[];
};
const baseData: Required<Data> = {
  courseMembers: people.map((p) => member('A', p.id)),
  coursePayments: [pay('C'), pay('E'), pay('A1', '2026-10-01')], // Amy's October mark doesn't count
  paymentExemptions: [ex('D'), ex('E')],
  paymentRequests: [req('Z'), req('B')],
};
const storeWith = (data: Data, over = {}) => {
  const base = fakeStore('M', {
    courseBilling: [{ courseId: 'A', startDay: 1, endDay: 5, selectedById: 'M', selectedAt: '2026-11-01T10:00:00.000Z' }],
    ...baseData,
    ...data,
    ...over,
  });
  return { ...base, currentUser: accountantM, users: all, getUser: (id?: string) => all.find((u) => u.id === id) };
};
const order = () => screen.getAllByTestId(/^payment-(Z|A1|B|C|D|E|X)$/).map((n) => String(n.props.testID).slice(8));
const opened = ['B', 'Z', 'A1', 'C', 'D', 'E'];

/** Replaces the store (as a reload or realtime change does) and re-renders. */
async function reload(rerender: (el: ReactElement) => unknown, s: ReturnType<typeof storeWith>) {
  setStore(s);
  await act(async () => {
    await rerender(<CoursePaymentsScreen />);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOV_3);
  params.id = 'A';
});
afterEach(() => jest.restoreAllMocks());

describe('helpers', () => {
  it('paymentRank: request 0, unpaid 1, paid 2, exempt 3', () => {
    expect(paymentRank({ kind: 'unpaid' }, true)).toBe(0);
    expect(paymentRank({ kind: 'unpaid' }, false)).toBe(1);
    expect(paymentRank({ kind: 'paid', payment: pay('C') }, false)).toBe(2);
    expect(paymentRank({ kind: 'exempt' }, false)).toBe(3);
  });

  it('byPaymentRank is stable; inFrozenOrder keeps places, drops gone ones and appends new ones', () => {
    const l = (id: string) => ({ id });
    expect(byPaymentRank([l('a'), l('b'), l('c')], (id) => (id === 'c' ? 0 : 1)).map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(inFrozenOrder([l('a'), l('b'), l('d')], ['b', 'c', 'a']).map((x) => x.id)).toEqual(['b', 'a', 'd']);
  });
});

describe('AC 1 / AC 4 / AC 5: the order when the page opens', () => {
  it('requests, then unpaid, then paid, then exempt; A–Z in each group; Exempt wins over Paid', async () => {
    setStore(storeWith({}));
    await render(<CoursePaymentsScreen />);
    expect(order()).toEqual(opened);
    expect(within(screen.getByTestId('payment-A1')).getByText('Unpaid')).toBeTruthy();
    expect(within(screen.getByTestId('payment-E')).getByText('Exempt')).toBeTruthy();
  });

  it('everyone paid or exempt: paid first, then exempt', async () => {
    setStore(
      storeWith({
        coursePayments: ['Z', 'A1', 'C'].map((u) => pay(u)),
        paymentExemptions: ['B', 'D', 'E'].map(ex),
        paymentRequests: [],
      }),
    );
    await render(<CoursePaymentsScreen />);
    expect(order()).toEqual(['A1', 'C', 'Z', 'B', 'D', 'E']);
  });

  it('everyone unpaid: requests first, then by name', async () => {
    setStore(storeWith({ coursePayments: [], paymentExemptions: [] }));
    await render(<CoursePaymentsScreen />);
    expect(order()).toEqual(opened);
  });

  it('listeners with the same name keep a stable order', async () => {
    const twins: User[] = [
      { id: 'X', name: 'Amy', role: 'student' },
      { id: 'A1', name: 'Amy', role: 'student' },
    ];
    const s = storeWith({
      courseMembers: [member('A', 'X'), member('A', 'A1')],
      coursePayments: [],
      paymentExemptions: [],
      paymentRequests: [],
    });
    setStore({ ...s, getUser: (id?: string) => twins.find((u) => u.id === id) });
    await render(<CoursePaymentsScreen />);
    expect(order()).toEqual(['A1', 'X']);
    await refocus();
    expect(order()).toEqual(['A1', 'X']);
  });

  it('the store loading after the page opened still gives the sorted order', async () => {
    setStore(storeWith({ courseMembers: [], coursePayments: [], paymentExemptions: [], paymentRequests: [] }));
    const { rerender } = await render(<CoursePaymentsScreen />);
    expect(screen.getByText('No listeners yet')).toBeTruthy();
    await reload(rerender, storeWith({}));
    expect(order()).toEqual(opened);
  });
});

describe('AC 2: the list does not jump while the page is open', () => {
  it('mark paid, undo paid, set and clear exempt (store reloads): rows stay, statuses change', async () => {
    const s = storeWith({});
    setStore(s);
    const { rerender } = await render(<CoursePaymentsScreen />);
    expect(order()).toEqual(opened);

    await fireEvent.press(screen.getByRole('button', { name: 'Mark Amy paid' }));
    await waitFor(() => expect(s.markPaid).toHaveBeenCalledWith('A', 'A1', MONTH));
    await reload(rerender, storeWith({ coursePayments: [...baseData.coursePayments, pay('A1')] }));
    expect(order()).toEqual(opened);
    expect(within(screen.getByTestId('payment-A1')).getByText(/^Paid/)).toBeTruthy();

    // Undo paid on Cat, exempt Bob, clear exempt on Dan, and another device marks Zed paid.
    await reload(rerender, storeWith({ coursePayments: [pay('E'), pay('A1'), pay('Z')], paymentExemptions: [ex('E'), ex('B')] }));
    expect(order()).toEqual(opened);
    expect(within(screen.getByTestId('payment-C')).getByText('Unpaid')).toBeTruthy();
    expect(within(screen.getByTestId('payment-B')).getByText('Exempt')).toBeTruthy();
    expect(within(screen.getByTestId('payment-D')).getByText('Unpaid')).toBeTruthy();
    expect(within(screen.getByTestId('payment-Z')).getByText(/^Paid/)).toBeTruthy();
  });

  it('a request arriving while open shows on the row without moving it', async () => {
    setStore(storeWith({ paymentRequests: [] }));
    const { rerender } = await render(<CoursePaymentsScreen />);
    expect(order()).toEqual(['A1', 'B', 'Z', 'C', 'D', 'E']);
    await reload(rerender, storeWith({ paymentRequests: [req('Z')] }));
    expect(order()).toEqual(['A1', 'B', 'Z', 'C', 'D', 'E']);
    expect(screen.getByTestId('request-Z')).toBeTruthy();
  });

  it('a listener who joins goes at the end; one who leaves is removed', async () => {
    setStore(storeWith({ courseMembers: people.filter((p) => p.id !== 'A1').map((p) => member('A', p.id)) }));
    const { rerender } = await render(<CoursePaymentsScreen />);
    expect(order()).toEqual(['B', 'Z', 'C', 'D', 'E']);
    await reload(rerender, storeWith({ courseMembers: people.filter((p) => p.id !== 'C').map((p) => member('A', p.id)) }));
    expect(order()).toEqual(['B', 'Z', 'D', 'E', 'A1']);
  });
});

describe('AC 3: sorted again on refresh and on focus', () => {
  const changed = { coursePayments: [...baseData.coursePayments, pay('A1'), pay('B')] };
  const resorted = ['Z', 'A1', 'B', 'C', 'D', 'E'];

  it('pull to refresh re-sorts after the refresh finishes', async () => {
    const s = storeWith({});
    setStore(s);
    const { rerender, container } = await render(<CoursePaymentsScreen />);
    await reload(rerender, storeWith(changed, { refresh: s.refresh }));
    expect(order()).toEqual(opened);
    await act(async () => {
      await container.queryAll((n) => !!n.props.refreshControl)[0].props.refreshControl.props.onRefresh();
    });
    expect(s.refresh).toHaveBeenCalled();
    expect(order()).toEqual(resorted);
  });

  it('a failed refresh still re-sorts what is loaded', async () => {
    const refresh = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    setStore(storeWith({}, { refresh }));
    const { rerender, container } = await render(<CoursePaymentsScreen />);
    await reload(rerender, storeWith(changed, { refresh }));
    await act(async () => {
      await container.queryAll((n) => !!n.props.refreshControl)[0].props.refreshControl.props.onRefresh();
    });
    expect(order()).toEqual(resorted);
  });

  it('coming back to the screen re-sorts', async () => {
    setStore(storeWith({}));
    const { rerender } = await render(<CoursePaymentsScreen />);
    await reload(rerender, storeWith(changed));
    expect(order()).toEqual(opened);
    await refocus();
    expect(order()).toEqual(resorted);
  });
});
