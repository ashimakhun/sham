// QA ARU-101: gaps in aru101-telegram-page.test.tsx / aru48-telegram-card.test.tsx: the Profile button's screen reader
// reading (label, hint, chevron hidden) and 44 pt target; a switch row is at least 44 pt; the page follows a role
// change (student → mentor) without reopening; after a confirmed Disconnect the page shows the not-connected state;
// leaving the page while a switch is still saving doesn't crash; Profile itself never shows Telegram errors or
// settings.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import TelegramScreen from '@/app/telegram';
import type { TelegramLink } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const linked: TelegramLink = {
  linkedAt: '2026-11-01T10:00:00.000Z',
  switches: { meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true },
};
const hidden = { includeHiddenElements: true };
const switches = () => screen.queryAllByRole('switch').map((s) => s.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

it('AC 1 / edge: the Profile button reads "Telegram notifications, button" with a hint; the chevron is hidden; 44 pt', async () => {
  setStore(fakeStore('S1', { telegram: linked }));
  await render(<ProfileScreen />);
  await act(async () => {});
  const btn = screen.getByRole('button', { name: 'Telegram notifications' });
  expect(btn.props.accessibilityHint).toBe('Opens the Telegram notifications page');
  const chevron = screen.getByTestId('icon-chevron-forward', hidden);
  expect(chevron.props.accessibilityElementsHidden).toBe(true);
  expect(chevron.props.importantForAccessibility).toBe('no');
  const s = StyleSheet.flatten(typeof btn.props.style === 'function' ? btn.props.style({ pressed: false }) : btn.props.style);
  expect(s.minHeight).toBeGreaterThanOrEqual(44);
});

it('edge: each switch row is at least 44 pt tall', async () => {
  setStore(fakeStore('M', { telegram: linked }));
  await render(<TelegramScreen />);
  for (const sw of screen.getAllByRole('switch')) {
    expect(StyleSheet.flatten(sw.parent!.props.style).minHeight).toBeGreaterThanOrEqual(44);
  }
});

it('edge: a role change while the page is open shows the new role\'s switches', async () => {
  setStore(fakeStore('S1', { telegram: linked }));
  const view = await render(<TelegramScreen />);
  expect(switches()).not.toContain('Homework submitted');
  const mentor = fakeStore('S1', { telegram: linked });
  setStore({ ...mentor, currentUser: { ...mentor.currentUser!, role: 'mentor' } });
  await view.rerender(<TelegramScreen />);
  expect(switches()).toContain('Homework submitted');
  expect(switches()).not.toContain('New accounts');
});

it('AC 7: after a confirmed Disconnect, the page shows the not-connected state', async () => {
  const store = fakeStore('S1', { telegram: linked });
  setStore(store);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await render(<TelegramScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Disconnect' }));
  const yes = alert.mock.lastCall![2]!.find((b) => b.text === 'Disconnect')!;
  await act(async () => yes.onPress!());
  expect(store.disconnectTelegram).toHaveBeenCalled();
  // The store then has no link.
  setStore(fakeStore('S1', { telegram: null }));
  await view.rerender(<TelegramScreen />);
  expect(screen.getByText('Get Sham notifications in Telegram.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
  expect(screen.queryAllByRole('switch')).toHaveLength(0);
  alert.mockRestore();
});

it('edge: leaving the page while a switch is still saving doesn\'t crash', async () => {
  let reject: (e: Error) => void = () => {};
  const setTelegramNotification = jest.fn(() => new Promise<void>((_r, j) => (reject = j)));
  setStore(fakeStore('S1', { telegram: linked, setTelegramNotification }));
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const view = await render(<TelegramScreen />);
  await fireEvent(screen.getByLabelText('Meeting started'), 'valueChange', false);
  expect(screen.getByLabelText('Meeting started').props.disabled).toBe(true);
  await view.unmount();
  await act(async () => reject(new Error('Network request failed')));
  expect(setTelegramNotification).toHaveBeenCalledTimes(1);
  errors.mockRestore();
});

it('Profile never shows Telegram settings or Telegram errors, and doesn\'t load Telegram itself', async () => {
  const store = fakeStore('S1', { telegram: linked, loadTelegram: jest.fn().mockRejectedValue(new Error('offline')) });
  setStore(store);
  await render(<ProfileScreen />);
  await act(async () => {});
  expect(screen.queryAllByRole('switch')).toHaveLength(0);
  expect(screen.queryByText('Connected to Telegram')).toBeNull();
  expect(screen.queryByText('offline')).toBeNull();
  expect(store.loadTelegram).not.toHaveBeenCalled();
});
