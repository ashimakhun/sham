// QA ARU-100: gaps in aru100-profile-chat-top.test.tsx: with 0 unread the label is exactly "Open general chat" and
// there is no badge; the badge follows the count live while Profile is open; the moved button keeps the secondary
// style and its badge on the icon (AC 3); the mentor's bottom group keeps its order.
import { act, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import { colors } from '@/lib/theme';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const hidden = { includeHiddenElements: true };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

const chat = () => screen.getByRole('button', { name: /^Open general chat/ });

it('AC 3: with 0 unread the label is exactly "Open general chat" and no badge shows', async () => {
  setStore(fakeStore('S1', { generalUnreadCount: 0 }));
  await render(<ProfileScreen />);
  await act(async () => {});
  expect(chat().props.accessibilityLabel).toBe('Open general chat');
  expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
});

it('AC 3: the badge on the icon follows the count live while Profile is open', async () => {
  setStore(fakeStore('S1', { generalUnreadCount: 0 }));
  const view = await render(<ProfileScreen />);
  await act(async () => {});
  for (const [n, text] of [
    [1, '1'],
    [5, '5'],
    [150, '99+'],
  ] as const) {
    setStore(fakeStore('S1', { generalUnreadCount: n }));
    await view.rerender(<ProfileScreen />);
    expect(within(chat()).getByTestId('unread-badge', hidden)).toBeTruthy();
    expect(within(chat()).getByText(text, hidden)).toBeTruthy();
  }
  setStore(fakeStore('S1', { generalUnreadCount: 0 }));
  await view.rerender(<ProfileScreen />);
  expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
});

it('AC 3: the moved button keeps the secondary style and the chat icon', async () => {
  setStore(fakeStore('M', { generalUnreadCount: 2 }));
  await render(<ProfileScreen />);
  await act(async () => {});
  const btn = chat();
  const s = StyleSheet.flatten(typeof btn.props.style === 'function' ? btn.props.style({ pressed: false }) : btn.props.style);
  expect(s.backgroundColor).toBe(colors.primarySoft);
  expect(within(btn).getByTestId('icon-chatbubble-outline', hidden)).toBeTruthy();
});

it('AC 2: the mentor\'s bottom group is Change password, Sign out, Delete account, with no chat button among them', async () => {
  setStore(fakeStore('M'));
  await render(<ProfileScreen />);
  await act(async () => {});
  const all = screen.getAllByRole('button');
  const idx = ['Change password', 'Sign out', 'Delete account'].map((n) => all.indexOf(screen.getByRole('button', { name: n })));
  expect(idx).toEqual([...idx].sort((a, b) => a - b));
  expect(idx[2]).toBe(all.length - 1);
  expect(all.indexOf(chat())).toBeLessThan(idx[0]);
  expect(screen.getAllByRole('button', { name: /^Open general chat/ })).toHaveLength(1);
});
