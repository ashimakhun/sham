// ARU-22: the "Make mentor" / "Make student" buttons on Manage roles have side padding, so the label sits inside
// the tinted background instead of touching or running past its edges.
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import RolesScreen from '@/app/roles';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/lib/confirm', () => ({ confirmDestructive: jest.fn() }));

const sidePadding = (el: { props: { style?: unknown } }) => {
  const s = StyleSheet.flatten(el.props.style as never) as Record<string, number | undefined>;
  return {
    left: s.paddingLeft ?? s.paddingHorizontal ?? s.padding ?? 0,
    right: s.paddingRight ?? s.paddingHorizontal ?? s.padding ?? 0,
  };
};

beforeEach(() => jest.clearAllMocks());

it.each([
  ['S1', 'Make mentor'],
  ['M2', 'Make student'],
])('the %s row button "%s" has horizontal padding of at least 12 on both sides', async (id, title) => {
  setStore(fakeStore('T'));
  await render(<RolesScreen />);
  const button = within(screen.getByTestId(`user-${id}`)).getByRole('button', { name: title });
  const { left, right } = sidePadding(button);
  expect(left).toBeGreaterThanOrEqual(12);
  expect(right).toBeGreaterThanOrEqual(12);
});

it('the row button does not shrink: the name column takes the leftover width instead', async () => {
  setStore(fakeStore('T'));
  await render(<RolesScreen />);
  const button = within(screen.getByTestId('user-S1')).getByRole('button', { name: 'Make mentor' });
  const s = StyleSheet.flatten(button.props.style) as { flexShrink?: number };
  expect(s.flexShrink ?? 0).toBe(0);
});
