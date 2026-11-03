// QA ARU-79: gaps in aru79-telegram-card-collapse.test.tsx: an unexpected saved value counts as expanded, a failed
// save keeps the session choice with no error, the key is per user and doesn't touch other storage keys (the Supabase
// session lives there too), collapsing the card leaves the rest of Profile alone, and the collapsed card exposes no
// switch or button to screen readers.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import { resetTelegramCardCollapsedCache, telegramCardCollapsedKey } from '@/components/TelegramCard';
import type { TelegramLink } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const linked: TelegramLink = {
  linkedAt: '2026-11-01T10:00:00.000Z',
  switches: { meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true },
};
const header = () => screen.getByRole('button', { name: 'Telegram notifications' });
async function renderProfile() {
  const view = await render(<ProfileScreen />);
  await act(async () => {});
  return view;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
  resetTelegramCardCollapsedCache();
  await AsyncStorage.clear();
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

it('edge: an unexpected saved value counts as expanded', async () => {
  await AsyncStorage.setItem(telegramCardCollapsedKey(users.S1.id), 'yes');
  setStore(fakeStore('S1', { telegram: linked }));
  await renderProfile();
  expect(header().props.accessibilityState).toMatchObject({ expanded: true });
  expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
});

it('edge: a failed save keeps the choice for the session and shows no error', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  setStore(fakeStore('S1', { telegram: linked }));
  const view = await renderProfile();
  await fireEvent.press(header());
  await act(async () => {});
  expect(header().props.accessibilityState).toMatchObject({ expanded: false });
  expect(screen.queryByText(/disk full|went wrong|couldn/i)).toBeNull();
  // Leaving Profile and coming back in the same session keeps it collapsed.
  await view.unmount();
  await renderProfile();
  expect(header().props.accessibilityState).toMatchObject({ expanded: false });
});

it('AC 5 / AC 6: only this user\'s key is written, and other storage keys (the Supabase session) are untouched', async () => {
  await AsyncStorage.setItem('sb-qokeforjnowgqhdhmrjv-auth-token', 'session');
  setStore(fakeStore('M', { telegram: linked }));
  await renderProfile();
  await fireEvent.press(header());
  await act(async () => {});
  const keys = [...(await AsyncStorage.getAllKeys())].sort();
  expect(keys).toEqual([telegramCardCollapsedKey(users.M.id), 'sb-qokeforjnowgqhdhmrjv-auth-token'].sort());
  expect(await AsyncStorage.getItem(telegramCardCollapsedKey(users.M.id))).toBe('1');
  expect(await AsyncStorage.getItem('sb-qokeforjnowgqhdhmrjv-auth-token')).toBe('session');
  expect(telegramCardCollapsedKey(users.M.id)).not.toBe(telegramCardCollapsedKey(users.S1.id));
});

it('AC 9: collapsed, no Telegram switch or button is reachable; the rest of Profile is still there', async () => {
  setStore(fakeStore('S1', { telegram: linked }));
  await renderProfile();
  const before = screen.getAllByRole('switch', { includeHiddenElements: true }).length;
  expect(before).toBeGreaterThan(0);
  await fireEvent.press(header());
  await act(async () => {});
  expect(screen.queryAllByRole('switch', { includeHiddenElements: true })).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  // Other Profile parts are unchanged.
  expect(screen.getByRole('button', { name: 'Edit name' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Open general chat/ })).toBeTruthy();
  expect(screen.getByText('Sign out')).toBeTruthy();
});
