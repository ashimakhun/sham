// QA ARU-114: gaps in aru114-request-icons.test.tsx: the glyphs and their colours and sizes (AC 1), the Declined badge
// sits under the date, is red text and not a button (AC 2, AC 6), the icons stay out of the text column for long names
// (edge case), the Declined Accept's touch height (AC 7), confirming the X while busy, a failed reject shows the error
// and keeps the row (AC 8), the rest of the page is unchanged (AC 9: section order, user-row buttons, search, hidden
// empty sections), and mentors / students still can't manage roles.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import RolesScreen from '@/app/roles';
import { colors } from '@/lib/theme';
import type { AccessRequest } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const req = (id: string, name: string, status: AccessRequest['status']): AccessRequest => ({
  id,
  name,
  email: `${id.toLowerCase()}@x.test`,
  createdAt: '2026-10-30T10:00:00.000Z',
  status,
});
const pending = req('P', 'Pending Pat', 'pending');
const rejected = req('R', 'Rejected Rae', 'rejected');
const flat = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;

beforeEach(() => jest.clearAllMocks());

it('AC 1: the check mark is a 20 pt green "checkmark", the X a 20 pt red "close", each inside its own circle', async () => {
  setStore(fakeStore('T', { accessRequests: [pending] }));
  await render(<RolesScreen />);
  const check = within(screen.getByTestId('accept-request-P')).getByTestId('icon-checkmark');
  const x = within(screen.getByTestId('reject-request-P')).getByTestId('icon-close');
  expect(check.props).toMatchObject({ size: 20, color: colors.success });
  expect(x.props).toMatchObject({ size: 20, color: colors.danger });
  // No old text Buttons left in the row.
  expect(within(screen.getByTestId('request-P')).queryAllByText(/^(Accept|Reject)$/)).toHaveLength(0);
});

it('AC 2 / AC 6: the Declined badge is red text under the sign-up date, and it is not a button', async () => {
  setStore(fakeStore('T', { accessRequests: [rejected] }));
  await render(<RolesScreen />);
  const row = screen.getByTestId('request-R');
  const texts = within(row).getAllByText(/./).map((t) => t.props.children);
  const date = texts.findIndex((c) => String(Array.isArray(c) ? c.join('') : c).startsWith('Signed up'));
  expect(texts.indexOf('Declined')).toBe(date + 1);
  const badge = within(row).getByText('Declined');
  expect(flat(badge).color).toBe(colors.danger);
  expect(screen.queryByRole('button', { name: /Declined/ })).toBeNull();
  // The Accept pill has the green check mark and green text.
  const pill = screen.getByTestId('accept-request-R');
  expect(within(pill).getByTestId('icon-checkmark').props.color).toBe(colors.success);
  expect(flat(within(pill).getByText('Accept')).color).toBe(colors.success);
});

it('AC 7: the Declined "Accept" button has a touch area at least 44 pt high', async () => {
  setStore(fakeStore('T', { accessRequests: [rejected] }));
  await render(<RolesScreen />);
  const pill = screen.getByTestId('accept-request-R');
  const slop = pill.props.hitSlop as number;
  expect((flat(pill).minHeight as number) + 2 * slop).toBeGreaterThanOrEqual(44);
});

it('edge case: with a long name the icons sit outside the flexible text column, so they are not pushed off-screen', async () => {
  const long = req('L', 'A'.repeat(120), 'pending');
  setStore(fakeStore('T', { accessRequests: [long] }));
  await render(<RolesScreen />);
  const accept = screen.getByTestId('accept-request-L');
  let p = accept.parent;
  while (p && p.props.testID !== 'request-L') {
    expect(flat(p).flex).toBeUndefined();
    p = p.parent;
  }
  expect(p).toBeTruthy();
  expect(screen.getByText('A'.repeat(120)).props.numberOfLines).toBe(2);
});

it('AC 8: a failed reject shows the error at the top and the request stays in Requests', async () => {
  const store = fakeStore('T', {
    accessRequests: [pending],
    setAccessStatus: jest.fn().mockRejectedValue(new Error('Network request failed')),
  });
  setStore(store);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<RolesScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Reject Pending Pat' }));
  await act(async () => alert.mock.lastCall![2]!.find((b) => b.text === 'Reject')!.onPress!());
  expect(store.setAccessStatus).toHaveBeenCalledWith('P', 'rejected');
  expect(screen.getByText('Network request failed')).toBeTruthy();
  expect(screen.getByTestId('request-P')).toBeTruthy();
  expect(screen.getByText('REQUESTS')).toBeTruthy();
});

it('AC 5: while a reject runs, the Declined row\'s Accept is disabled too and a tap does nothing', async () => {
  let finish!: () => void;
  const store = fakeStore('T', {
    accessRequests: [pending, rejected],
    setAccessStatus: jest.fn(() => new Promise<void>((resolve) => (finish = resolve))),
  });
  setStore(store);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<RolesScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Reject Pending Pat' }));
  await act(async () => {
    void alert.mock.lastCall![2]!.find((b) => b.text === 'Reject')!.onPress!();
  });
  const pill = screen.getByRole('button', { name: 'Accept Rejected Rae' });
  expect(pill.props.accessibilityState).toMatchObject({ disabled: true });
  expect(flat(pill).opacity).toBe(0.4);
  await fireEvent.press(pill);
  expect(store.setAccessStatus).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});

it('AC 9: section order, user-row buttons and the Accountant switch are unchanged', async () => {
  setStore(fakeStore('T', { accessRequests: [pending, rejected] }));
  await render(<RolesScreen />);
  const order = ['REQUESTS', 'TEACHER', 'MENTORS', 'STUDENTS', 'DECLINED'].map((t) =>
    screen.getAllByText(/^[A-Z]+$/).findIndex((n) => n.props.children === t),
  );
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(screen.getAllByRole('button', { name: 'Make mentor' }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: 'Make student' }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
});

it('AC 9: search still filters requests by name, and empty Requests / Declined sections stay hidden', async () => {
  setStore(fakeStore('T', { accessRequests: [pending, rejected] }));
  await render(<RolesScreen />);
  await fireEvent.changeText(screen.getByLabelText('Search users'), 'rae');
  expect(screen.queryByTestId('request-P')).toBeNull();
  expect(screen.getByTestId('accept-request-R')).toBeTruthy();
  expect(screen.queryByText('REQUESTS')).toBeNull();
  expect(screen.getByText('DECLINED')).toBeTruthy();
});

it.each(['M', 'S1'] as const)('access: %s gets no request icons on the Roles page', async (who) => {
  setStore(fakeStore(who, { accessRequests: [pending, rejected] }));
  await render(<RolesScreen />);
  expect(screen.queryByTestId('accept-request-P')).toBeNull();
  expect(screen.queryByTestId('reject-request-P')).toBeNull();
  expect(screen.queryByTestId('accept-request-R')).toBeNull();
});
