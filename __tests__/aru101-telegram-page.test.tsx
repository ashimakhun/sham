// ARU-101: on Profile, Telegram notifications is one "Telegram notifications >" button that opens the Telegram
// notifications page; the ARU-79 collapse is gone. The page's connect / switches / disconnect behaviour is covered in
// aru48-telegram-card, aru84, aru87 and aru89 (they render the page now).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import ProfileScreen from '@/app/(tabs)/profile';
import TelegramScreen from '@/app/telegram';
import type { TelegramLink, User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { refocus, setStore } from './helpers/mocks';

// Paths are relative to the repo root (Jest's working directory), as in aru74-migration-numbers-qa.test.ts.
const fs = jest.requireActual<{ readFileSync: (file: string, encoding: 'utf8') => string }>('fs');

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const linked: TelegramLink = {
  linkedAt: '2026-11-01T10:00:00.000Z',
  switches: { meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true },
};
const tgButton = () => screen.getByRole('button', { name: 'Telegram notifications' });

beforeEach(async () => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
  await AsyncStorage.clear();
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

async function renderProfile() {
  const view = await render(<ProfileScreen />);
  await act(async () => {});
  return view;
}

describe('Profile button (AC 1, 2, 9)', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees one "Telegram notifications" button with a chevron and no Telegram settings', async (who) => {
    setStore(fakeStore(who, { telegram: linked }));
    await renderProfile();
    expect(screen.getAllByRole('button', { name: 'Telegram notifications' })).toHaveLength(1);
    expect(screen.getByText('Telegram notifications')).toBeTruthy();
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
    setStore({ ...fakeStore('M', { telegram: null }), currentUser: accountant });
    const view = await renderProfile();
    const json = JSON.stringify(view.toJSON());
    const pos = [users.M.name, 'Telegram notifications', 'ACCOUNTANT', 'Change password'].map((m) => json.indexOf(m));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  it('AC 2 / AC 3: a tap opens the page and expands nothing on Profile', async () => {
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    await fireEvent.press(tgButton());
    expect(router.push).toHaveBeenCalledWith('/telegram');
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
    expect(screen.queryByText('Get Sham notifications in Telegram.')).toBeNull();
  });

  it('AC 3: a double tap opens one page; after coming back to Profile it opens again', async () => {
    setStore(fakeStore('S1', { telegram: null }));
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
    setStore(fakeStore('S1', { telegram: linked }));
    await renderProfile();
    expect(tgButton()).toBeTruthy();
    expect(screen.getByTestId('icon-chevron-forward', { includeHiddenElements: true })).toBeTruthy();
  });

  it('AC 9: no bot configured: no button, the rest of Profile unchanged', async () => {
    delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    expect(screen.queryByRole('button', { name: 'Telegram notifications' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('Telegram notifications page', () => {
  it('AC 3: registered as a pushed stack screen titled "Telegram notifications" (not a modal)', () => {
    const layout = fs.readFileSync('src/app/_layout.tsx', 'utf8');
    const line = layout.split('\n').find((l: string) => l.includes('name="telegram"'));
    // ARU-113: the title comes from the catalog; in English it reads "Telegram notifications".
    expect(line).toContain("title: t('telegram.title')");
    expect(require('@/i18n/en.json')['telegram.title']).toBe('Telegram notifications');
    expect(line).not.toContain('modal');
  });

  it('AC 4 / AC 5: not connected shows Connect; connected shows the switches, note and Disconnect', async () => {
    setStore(fakeStore('S1', { telegram: null }));
    const view = await render(<TelegramScreen />);
    expect(screen.getByText('Get Sham notifications in Telegram.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
    await view.unmount();
    setStore(fakeStore('S1', { telegram: linked }));
    await render(<TelegramScreen />);
    expect(screen.getByText('Connected to Telegram')).toBeTruthy();
    expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    expect(screen.getByText("You'll keep getting these after signing out of the app.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('AC 8: the page refetches when focused again (back from Telegram) and shows the connected state', async () => {
    const store = fakeStore('S1', { telegram: null });
    setStore(store);
    const view = await render(<TelegramScreen />);
    expect(store.loadTelegram).toHaveBeenCalledTimes(1);
    setStore({ ...store, telegram: linked });
    await refocus();
    await view.rerender(<TelegramScreen />);
    expect(store.loadTelegram).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Connected to Telegram')).toBeTruthy();
  });

  it('edge: a failed load shows an error on the page and keeps the last state; a later load clears it', async () => {
    let fail = true;
    const store = fakeStore('S1', {
      telegram: linked,
      loadTelegram: jest.fn(async () => {
        if (fail) throw new Error('Network request failed');
      }),
    });
    setStore(store);
    await render(<TelegramScreen />);
    await act(async () => {});
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(screen.getByText('Connected to Telegram')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    fail = false;
    await refocus();
    expect(screen.queryByText('Network request failed')).toBeNull();
  });

  it('AC 9: opened directly with no bot configured, it shows a short note and no settings', async () => {
    delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
    setStore(fakeStore('S1', { telegram: null }));
    await render(<TelegramScreen />);
    expect(screen.getByText('Telegram notifications are not available.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
  });
});
