// ARU-101: on Profile, notifications are one button that opens their own page; the ARU-79 collapse is gone. Since
// ARU-166 the button is "Notifications >" (the Telegram page itself was removed by ARU-171); the page's switches are
// covered in aru166, aru84, aru87 and aru89.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import ProfileScreen from '@/app/(tabs)/profile';
import type { User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

// ARU-166 AC 7: Profile's button is "Notifications >" now, in the same place, for every role; it opens the
// Notifications page. The checks below keep ARU-101's button rules for it.
const tgButton = () => screen.getByRole('button', { name: 'Notifications' });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

async function renderProfile() {
  const view = await render(<ProfileScreen />);
  await act(async () => {});
  return view;
}

describe('Profile button (AC 1, 2, 9)', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees one "Notifications" button (ARU-166) with a chevron and no Telegram settings', async (who) => {
    setStore(fakeStore(who));
    await renderProfile();
    expect(screen.getAllByRole('button', { name: 'Notifications' })).toHaveLength(1);
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Telegram notifications' })).toBeNull();
    expect(screen.getByTestId('icon-chevron-forward', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('icon-chevron-down', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText('TELEGRAM NOTIFICATIONS')).toBeNull();
    expect(screen.queryByText('Connected to Telegram')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.queryAllByRole('switch')).toEqual([]);
  });

  it('AC 1: same place as the card: after the name card, before the Accountant section and the bottom buttons', async () => {
    const accountant: User = { ...users.M, isAccountant: true };
    setStore({ ...fakeStore('M'), currentUser: accountant });
    const view = await renderProfile();
    const json = JSON.stringify(view.toJSON());
    const pos = [users.M.name, 'Notifications', 'ACCOUNTANT', 'Change password'].map((m) => json.indexOf(m));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  it('AC 2 / AC 3: a tap opens the page and expands nothing on Profile', async () => {
    setStore(fakeStore('S1'));
    await renderProfile();
    await fireEvent.press(tgButton());
    expect(router.push).toHaveBeenCalledWith('/notifications');
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
    expect(screen.queryByText('Get Sham notifications in Telegram.')).toBeNull();
  });

  it('AC 3: a double tap opens one page; after coming back to Profile it opens again', async () => {
    setStore(fakeStore('S1'));
    await renderProfile();
    await fireEvent.press(tgButton());
    await fireEvent.press(tgButton());
    expect(router.push).toHaveBeenCalledTimes(1);
    await refocus();
    await fireEvent.press(tgButton());
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it('edge: a collapsed choice saved by the old ARU-79 card is ignored', async () => {
    await AsyncStorage.setItem(`sham.telegramCard.collapsed.${users.S1.id}`, '1');
    setStore(fakeStore('S1'));
    await renderProfile();
    expect(tgButton()).toBeTruthy();
    expect(screen.getByTestId('icon-chevron-forward', { includeHiddenElements: true })).toBeTruthy();
  });

  it('ARU-166 AC 7: the Notifications button is there, no Telegram button', async () => {
    setStore(fakeStore('S1'));
    await renderProfile();
    expect(screen.queryByRole('button', { name: 'Telegram notifications' })).toBeNull();
    expect(tgButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
