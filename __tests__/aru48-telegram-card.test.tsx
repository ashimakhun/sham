// ARU-48: Telegram notifications settings, on the Telegram notifications page since ARU-101 (was a card on the Profile tab) (app side of AC 1, 4, 5, 6, 9). The bot and the database
// are tested in supabase/functions/_shared/*.test.ts and supabase/tests/aru48_telegram_links.test.sql.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, AppState, Linking } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import TelegramScreen from '@/app/telegram';
import type { TelegramLink } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const linked = (over: Partial<TelegramLink['switches']> = {}): TelegramLink => ({
  linkedAt: '2026-11-01T10:00:00.000Z',
  switches: { meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true, ...over },
});
const switches = () => screen.queryAllByRole('switch').map((s) => s.props.accessibilityLabel);

let openUrl: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
  openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
  openUrl.mockRestore();
});

describe('Connect (AC 1)', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees Connect on the page when not connected', async (who) => {
    setStore(fakeStore(who, { telegram: null }));
    await render(<TelegramScreen />);
    expect(screen.getByText('Get Sham notifications in Telegram.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
    expect(switches()).toEqual([]);
  });

  it('Connect gets a code and opens the bot link', async () => {
    const store = fakeStore('S1', { telegram: null, createTelegramLinkCode: jest.fn(async () => 'abc_123') });
    setStore(store);
    await render(<TelegramScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Connect Telegram' }));
    expect(store.createTelegramLinkCode).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith('https://t.me/ShamSchoolBot?start=abc_123');
  });

  it('a "@" in the configured username is ignored', async () => {
    process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = '@ShamSchoolBot';
    setStore(fakeStore('S1', { telegram: null }));
    await render(<TelegramScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Connect Telegram' }));
    expect(openUrl).toHaveBeenCalledWith('https://t.me/ShamSchoolBot?start=CODE123');
  });

  it('a double tap makes one code', async () => {
    let finish: (code: string) => void = () => {};
    const store = fakeStore('S1', {
      telegram: null,
      createTelegramLinkCode: jest.fn(() => new Promise<string>((resolve) => (finish = resolve))),
    });
    setStore(store);
    await render(<TelegramScreen />);
    const button = screen.getByRole('button', { name: 'Connect Telegram' });
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(store.createTelegramLinkCode).toHaveBeenCalledTimes(1);
    await act(async () => finish('c1'));
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it('a failed code request shows the error and opens nothing', async () => {
    setStore(
      fakeStore('S1', { telegram: null, createTelegramLinkCode: jest.fn().mockRejectedValue(new Error('Network request failed')) }),
    );
    await render(<TelegramScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Connect Telegram' }));
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe('Hidden (AC 9)', () => {
  it('no bot username configured: no Telegram button on Profile, the rest of Profile unchanged', async () => {
    delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
    setStore(fakeStore('S1', { telegram: null }));
    await render(<ProfileScreen />);
    expect(screen.queryByRole('button', { name: 'Telegram notifications' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('a blank username also hides it', async () => {
    process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = '   ';
    setStore(fakeStore('T', { telegram: null }));
    await render(<ProfileScreen />);
    expect(screen.queryByRole('button', { name: 'Telegram notifications' })).toBeNull();
  });
});

describe('Coming back from Telegram (AC 4)', () => {
  it('refetches on focus and when the app returns to the foreground', async () => {
    const store = fakeStore('S1', { telegram: null });
    setStore(store);
    const listeners: ((s: string) => void)[] = [];
    // AppState.addEventListener is already a jest mock here: replace it for this one subscription only.
    jest.spyOn(AppState, 'addEventListener').mockImplementationOnce((_e, cb) => {
      listeners.push(cb as (s: string) => void);
      return { remove: jest.fn() } as never;
    });
    const view = await render(<TelegramScreen />);
    expect(store.loadTelegram).toHaveBeenCalledTimes(1);
    await refocus();
    expect(store.loadTelegram).toHaveBeenCalledTimes(2);
    await act(async () => listeners.forEach((cb) => cb('active')));
    expect(store.loadTelegram).toHaveBeenCalledTimes(3);
    await act(async () => listeners.forEach((cb) => cb('background')));
    expect(store.loadTelegram).toHaveBeenCalledTimes(3);
    await view.unmount();
  });

  it('once linked, shows Connected, the switches and Disconnect', async () => {
    setStore(fakeStore('S1', { telegram: linked() }));
    await render(<TelegramScreen />);
    expect(screen.getByText('Connected to Telegram')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(screen.getByText("You'll keep getting these after signing out of the app.")).toBeTruthy();
  });
});

describe('Switches (AC 5)', () => {
  it.each([
    ['S1', ['Meeting started', 'New homework', 'Homework reviewed', 'Chat messages', 'General chat', 'New materials']],
    ['M', ['Meeting started', 'New homework', 'Homework reviewed', 'Homework submitted', 'Chat messages', 'General chat', 'New materials']],
  ] as const)('%s sees the listener switches (mentors also Homework submitted, ARU-89; General chat, ARU-87), as saved', async (who, labels) => {
    setStore(fakeStore(who, { telegram: linked({ new_homework: false }) }));
    await render(<TelegramScreen />);
    expect(switches()).toEqual(labels);
    expect(screen.getByLabelText('New homework').props.value).toBe(false);
    expect(screen.getByLabelText('Chat messages').props.value).toBe(true);
  });

  it('the teacher sees Homework submitted (ARU-89), Chat messages, General chat (ARU-87), New accounts (ARU-84)', async () => {
    setStore(fakeStore('T', { telegram: linked() }));
    await render(<TelegramScreen />);
    expect(switches()).toEqual(['Homework submitted', 'Chat messages', 'General chat', 'New materials', 'New accounts']);
  });

  it('flipping a switch saves it', async () => {
    const store = fakeStore('S1', { telegram: linked() });
    setStore(store);
    await render(<TelegramScreen />);
    await fireEvent(screen.getByLabelText('Meeting started'), 'valueChange', false);
    expect(store.setTelegramNotification).toHaveBeenCalledWith('meeting_started', false);
  });

  it('a failed save puts the switch back and shows the error', async () => {
    const store = fakeStore('S1', {
      telegram: linked(),
      setTelegramNotification: jest.fn().mockRejectedValue(new Error('Network request failed')),
    });
    setStore(store);
    await render(<TelegramScreen />);
    await fireEvent(screen.getByLabelText('Chat messages'), 'valueChange', false);
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(screen.getByLabelText('Chat messages').props.value).toBe(true);
  });
});

describe('Disconnect (AC 6)', () => {
  it('asks first; confirming disconnects', async () => {
    const store = fakeStore('S1', { telegram: linked() });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<TelegramScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Disconnect' }));
    expect(alert).toHaveBeenCalledWith('Disconnect Telegram', 'Stop Sham notifications in Telegram?', expect.any(Array), expect.any(Object));
    const yes = alert.mock.lastCall![2]!.find((b) => b.text === 'Disconnect')!;
    await act(async () => yes.onPress!());
    expect(store.disconnectTelegram).toHaveBeenCalled();
  });

  it('cancelling changes nothing', async () => {
    const store = fakeStore('S1', { telegram: linked() });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<TelegramScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Disconnect' }));
    const cancel = alert.mock.lastCall![2]!.find((b) => b.style === 'cancel')!;
    await act(async () => cancel.onPress!());
    expect(store.disconnectTelegram).not.toHaveBeenCalled();
  });
});
