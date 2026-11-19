// QA ARU-101: gaps in aru101-telegram-page.test.tsx: the Profile button's screen reader reading (label, hint, chevron
// hidden) and 44 pt target; a switch row is at least 44 pt; the page follows a role change (student → mentor) without
// reopening; leaving the page while a switch is still saving doesn't crash; Profile itself never shows switches or
// their errors. (ARU-171 removed the Telegram page and its Disconnect check.)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import NotificationsScreen from '@/app/notifications';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const hidden = { includeHiddenElements: true };
const switches = () => screen.queryAllByRole('switch').map((s) => s.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
});

// ARU-171: the Telegram page is gone; the switch checks below run on the Notifications page (ARU-166), which took
// its switches.

// ARU-166 AC 7: the Profile button is "Notifications" now (same place and rules).
it('AC 1 / edge: the Profile button reads "Notifications, button" with a hint; the chevron is hidden; 44 pt', async () => {
  setStore(fakeStore('S1'));
  await render(<ProfileScreen />);
  await act(async () => {});
  const btn = screen.getByRole('button', { name: 'Notifications' });
  expect(btn.props.accessibilityHint).toBe('Opens the Notifications page');
  const chevron = screen.getByTestId('icon-chevron-forward', hidden);
  expect(chevron.props.accessibilityElementsHidden).toBe(true);
  expect(chevron.props.importantForAccessibility).toBe('no');
  const s = StyleSheet.flatten(typeof btn.props.style === 'function' ? btn.props.style({ pressed: false }) : btn.props.style);
  expect(s.minHeight).toBeGreaterThanOrEqual(44);
});

it('edge: each switch row is at least 44 pt tall', async () => {
  setStore(fakeStore('M'));
  await render(<NotificationsScreen />);
  for (const sw of screen.getAllByRole('switch')) {
    expect(StyleSheet.flatten(sw.parent!.props.style).minHeight).toBeGreaterThanOrEqual(44);
  }
});

it('edge: a role change while the page is open shows the new role\'s switches', async () => {
  setStore(fakeStore('S1'));
  const view = await render(<NotificationsScreen />);
  expect(switches()).not.toContain('Homework submitted');
  const mentor = fakeStore('S1');
  setStore({ ...mentor, currentUser: { ...mentor.currentUser!, role: 'mentor' } });
  await view.rerender(<NotificationsScreen />);
  expect(switches()).toContain('Homework submitted');
  expect(switches()).not.toContain('New accounts');
});

it('edge: leaving the page while a switch is still saving doesn\'t crash', async () => {
  let reject: (e: Error) => void = () => {};
  const setNotification = jest.fn(() => new Promise<void>((_r, j) => (reject = j)));
  setStore(fakeStore('S1', { setNotification }));
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const view = await render(<NotificationsScreen />);
  await fireEvent(screen.getByLabelText('Meeting started'), 'valueChange', false);
  expect(screen.getByLabelText('Meeting started').props.disabled).toBe(true);
  await view.unmount();
  await act(async () => reject(new Error('Network request failed')));
  expect(setNotification).toHaveBeenCalledTimes(1);
  errors.mockRestore();
});

it('Profile shows no notification switches and no Telegram settings, and doesn\'t load the switches itself', async () => {
  const store = fakeStore('S1', { loadNotificationSettings: jest.fn().mockRejectedValue(new Error('offline')) });
  setStore(store);
  await render(<ProfileScreen />);
  await act(async () => {});
  expect(screen.queryAllByRole('switch')).toHaveLength(0);
  expect(screen.queryByText('Connected to Telegram')).toBeNull();
  expect(screen.queryByText('offline')).toBeNull();
  expect(store.loadNotificationSettings).not.toHaveBeenCalled();
});
