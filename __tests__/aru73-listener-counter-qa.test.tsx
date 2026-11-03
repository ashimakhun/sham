// QA ARU-73: gaps in aru73-listener-counter.test.tsx: the badge always agrees with the New (N) chip (1, 9, 10, 100 →
// "99+"), a mentor removed from their last course who has sent nothing loses the switch and the badge and falls back
// to Owner, pull-to-refresh with new data raises the count, the badge is not its own screen-reader element, and the
// badge never makes the Listener segment taller than Owner.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import type { HomeworkAssignment } from '@/lib/types';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const hidden = { includeHiddenElements: true };
const asg = (id: string, day = 1): HomeworkAssignment => ({
  id,
  courseId: 'A',
  meetingId: `m-${id}`,
  title: `Assignment ${id}`,
  description: '',
  createdById: 'M',
  createdAt: new Date(Date.UTC(2026, 9, 1) + day * 60_000).toISOString(),
});
const many = (n: number) => Array.from({ length: n }, (_, i) => asg(`a${i}`, i));
const ownB = { ...courseB, createdById: 'M2' };
const members = [member('A', 'S1'), member('A', 'M2')];
const store = (over = {}) => fakeStore('M2', { courses: [ownB, courseA], courseMembers: members, ...over });
const listenerTab = () => screen.getByRole('tab', { name: /^Listener/ });
const badgeText = () => {
  const b = within(listenerTab()).queryByTestId('unread-badge', hidden);
  return b ? within(b).getByText(/./, hidden).props.children : null;
};

beforeEach(() => jest.clearAllMocks());

it.each([
  [1, '1'],
  [9, '9'],
  [10, '10'],
  [100, '99+'],
])('AC 1 / AC 3 / AC 4: with %i new the badge reads "%s" and New shows the full count', async (n, shown) => {
  setStore(store({ assignments: many(n) }));
  await render(<HomeworkScreen />);
  expect(badgeText()).toBe(shown);
  expect(listenerTab().props.accessibilityLabel).toBe(`Listener, ${shown} new homework`);
  await fireEvent.press(listenerTab());
  expect(screen.getByText(`New (${n})`)).toBeTruthy();
  expect(badgeText()).toBe(shown); // still shown while on Listener
});

it('edge: removed from the last course with nothing sent, the switch and badge go and the tab falls back to Owner', async () => {
  setStore(store({ assignments: many(2) }));
  const view = await render(<HomeworkScreen />);
  await fireEvent.press(listenerTab());
  expect(screen.getByText('New (2)')).toBeTruthy();
  setStore(store({ assignments: many(2), courseMembers: [member('A', 'S1')] }));
  await view.rerender(<HomeworkScreen />);
  expect(screen.queryByRole('tab', { name: /^Listener/ })).toBeNull();
  expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
  expect(screen.getByText(/^To check/)).toBeTruthy();
});

it('AC 5: pull-to-refresh that brings a new assignment raises the count while on Owner', async () => {
  const refresh = jest.fn(async () => {});
  setStore(store({ assignments: many(1), refresh }));
  const view = await render(<HomeworkScreen />);
  const list = view.container.queryAll((n) => typeof n.props.onRefresh === 'function')[0];
  await fireEvent(list, 'refresh');
  expect(refresh).toHaveBeenCalled();
  setStore(store({ assignments: many(2), refresh }));
  await view.rerender(<HomeworkScreen />);
  expect(screen.getByText(/^To check/)).toBeTruthy();
  expect(badgeText()).toBe('2');
});

it('AC 7: the badge is hidden from screen readers; the tab is the only element read', async () => {
  setStore(store({ assignments: many(3) }));
  await render(<HomeworkScreen />);
  expect(within(listenerTab()).queryByTestId('unread-badge')).toBeNull(); // not found without hidden elements
  expect(within(listenerTab()).queryByText('3')).toBeNull();
  expect(listenerTab().props.accessibilityState).toMatchObject({ selected: false });
});

it('AC 3: the badge sits inline after the label and doesn\'t make Listener taller than Owner', async () => {
  setStore(store({ assignments: many(3) }));
  await render(<HomeworkScreen />);
  const owner = StyleSheet.flatten(screen.getByRole('tab', { name: 'Owner' }).props.style);
  const listener = StyleSheet.flatten(listenerTab().props.style);
  expect(listener.flexDirection).toBe('row');
  expect(listener.paddingVertical ?? listener.padding).toEqual(owner.paddingVertical ?? owner.padding);
  const badge = within(listenerTab()).getByTestId('unread-badge', hidden);
  const style = StyleSheet.flatten(badge.props.style);
  expect(style.position).not.toBe('absolute');
  expect(style.marginVertical).toBeLessThanOrEqual(0);
  expect(within(listenerTab()).getByText('Listener', hidden).props.numberOfLines).toBe(1);
});
