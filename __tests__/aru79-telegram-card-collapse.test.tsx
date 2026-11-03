// ARU-79: the Telegram notifications card on Profile collapses to its header and expands again; the choice is kept on
// the device per user (AsyncStorage, the in-memory mock from jest.setup.js).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import { resetTelegramCardCollapsedCache, telegramCardCollapsedKey } from '@/components/TelegramCard';
import type { TelegramLink } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const linked = (over: Partial<TelegramLink['switches']> = {}): TelegramLink => ({
  linkedAt: '2026-11-01T10:00:00.000Z',
  switches: { meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true, ...over },
});
const header = () => screen.getByRole('button', { name: 'Telegram notifications' });
const tapHeader = () => fireEvent.press(header());
const isCollapsed = () => !!screen.queryByTestId('icon-chevron-forward');

/** Renders Profile and lets the saved choice load. */
async function renderProfile() {
  const view = await render(<ProfileScreen />);
  await act(async () => {});
  return view;
}

let openUrl: jest.SpyInstance;
beforeEach(async () => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
  openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  resetTelegramCardCollapsedCache();
  await AsyncStorage.clear();
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
  openUrl.mockRestore();
});

describe('Header toggle (AC 1, 9)', () => {
  it('is a button with a chevron, down when expanded and right when collapsed', async () => {
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    expect(screen.getByText('TELEGRAM NOTIFICATIONS')).toBeTruthy();
    expect(header().props.accessibilityState).toEqual(expect.objectContaining({ expanded: true }));
    expect(screen.getByTestId('icon-chevron-down')).toBeTruthy();
    expect(screen.queryByTestId('icon-chevron-forward')).toBeNull();
    await tapHeader();
    expect(screen.getByTestId('icon-chevron-forward')).toBeTruthy();
    expect(screen.queryByTestId('icon-chevron-down')).toBeNull();
    expect(header().props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
  });

  it('the header row is at least 44 pt tall', async () => {
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    const style = [header().props.style].flat(Infinity).reduce((a, s) => ({ ...a, ...(s || {}) }), {});
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('tapping the card body does not toggle', async () => {
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    await fireEvent.press(screen.getByText('Get Sham notifications in Telegram.'));
    expect(isCollapsed()).toBe(false);
  });
});

describe('Collapse and expand (AC 2, 3, 7)', () => {
  it('not connected: hides the text and Connect, then shows them again', async () => {
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    await tapHeader();
    expect(screen.queryByText('Get Sham notifications in Telegram.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
    expect(screen.getByText('TELEGRAM NOTIFICATIONS')).toBeTruthy();
    await tapHeader();
    expect(screen.getByText('Get Sham notifications in Telegram.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
  });

  it('connected: hides status, switches, note and Disconnect; expanding shows current values', async () => {
    const store = fakeStore('M', { telegram: linked() });
    setStore(store);
    const view = await renderProfile();
    await fireEvent(screen.getByLabelText('New homework'), 'valueChange', false);
    await tapHeader();
    expect(screen.queryByText('Connected to Telegram')).toBeNull();
    expect(screen.queryAllByRole('switch')).toEqual([]);
    expect(screen.queryByText("You'll keep getting these after signing out of the app.")).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    // The value changed elsewhere while collapsed (refetch): expanding shows it.
    setStore({ ...store, telegram: linked({ new_homework: false, chat_message: false }) });
    await view.rerender(<ProfileScreen />);
    await tapHeader();
    expect(screen.getByText('Connected to Telegram')).toBeTruthy();
    expect(screen.getByLabelText('New homework').props.value).toBe(false);
    expect(screen.getByLabelText('Chat messages').props.value).toBe(false);
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('connecting or disconnecting keeps the choice', async () => {
    const store = fakeStore('S1', { telegram: null });
    setStore(store);
    const view = await renderProfile();
    await tapHeader();
    setStore({ ...store, telegram: linked() });
    await view.rerender(<ProfileScreen />);
    expect(isCollapsed()).toBe(true);
    expect(screen.queryByText('Connected to Telegram')).toBeNull();
    await tapHeader();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(screen.getByRole('button', { name: 'Disconnect' }));
    const yes = alert.mock.lastCall![2]!.find((b) => b.text === 'Disconnect')!;
    await act(async () => yes.onPress!());
    setStore({ ...store, telegram: null });
    await view.rerender(<ProfileScreen />);
    expect(isCollapsed()).toBe(false);
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
  });
});

describe('Default and remembered (AC 4, 5)', () => {
  it('expanded when never toggled', async () => {
    setStore(fakeStore('T', { telegram: linked() }));
    await renderProfile();
    expect(isCollapsed()).toBe(false);
    expect(screen.getByText('Connected to Telegram')).toBeTruthy();
  });

  it('collapsing saves the choice for this user, and coming back to Profile keeps it', async () => {
    setStore(fakeStore('S1', { telegram: linked() }));
    const view = await renderProfile();
    await tapHeader();
    expect(await AsyncStorage.getItem(telegramCardCollapsedKey('S1'))).toBe('1');
    await view.unmount();
    await render(<ProfileScreen />);
    // Known in this app session: collapsed at once, no flash of the content.
    expect(isCollapsed()).toBe(true);
    expect(screen.queryByText('Connected to Telegram')).toBeNull();
  });

  it('after an app restart, a saved collapsed choice shows collapsed without flashing open', async () => {
    await AsyncStorage.setItem(telegramCardCollapsedKey('S1'), '1');
    setStore(fakeStore('S1', { telegram: linked() }));
    await render(<ProfileScreen />);
    expect(screen.queryByText('Connected to Telegram')).toBeNull();
    await act(async () => {});
    expect(isCollapsed()).toBe(true);
    expect(screen.queryByText('Connected to Telegram')).toBeNull();
  });

  it('after an app restart, a saved expanded choice shows expanded', async () => {
    await AsyncStorage.setItem(telegramCardCollapsedKey('S1'), '0');
    setStore(fakeStore('S1', { telegram: linked() }));
    await renderProfile();
    expect(isCollapsed()).toBe(false);
    expect(screen.getByText('Connected to Telegram')).toBeTruthy();
  });

  it('expanding again saves expanded', async () => {
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    await tapHeader();
    await tapHeader();
    expect(await AsyncStorage.getItem(telegramCardCollapsedKey('S1'))).toBe('0');
  });
});

describe('Per user (AC 6)', () => {
  it("another user on the same device gets their own choice, without restarting", async () => {
    setStore(fakeStore('S1', { telegram: null }));
    const view = await renderProfile();
    await tapHeader();
    expect(isCollapsed()).toBe(true);
    setStore(fakeStore('M', { telegram: null }));
    await view.rerender(<ProfileScreen />);
    await act(async () => {});
    expect(isCollapsed()).toBe(false);
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
    setStore(fakeStore('S1', { telegram: null }));
    await view.rerender(<ProfileScreen />);
    await act(async () => {});
    expect(isCollapsed()).toBe(true);
    expect(await AsyncStorage.getItem(telegramCardCollapsedKey('M'))).toBeNull();
  });
});

describe('Nothing else changes (AC 8) and edge cases', () => {
  it('collapsing calls no store action', async () => {
    const store = fakeStore('S1', { telegram: linked() });
    setStore(store);
    await renderProfile();
    await tapHeader();
    await tapHeader();
    expect(store.setTelegramNotification).not.toHaveBeenCalled();
    expect(store.disconnectTelegram).not.toHaveBeenCalled();
    expect(store.createTelegramLinkCode).not.toHaveBeenCalled();
  });

  it('a switch save in progress when collapsing still finishes', async () => {
    let finish: () => void = () => {};
    const store = fakeStore('S1', {
      telegram: linked(),
      setTelegramNotification: jest.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    setStore(store);
    await renderProfile();
    await fireEvent(screen.getByLabelText('Meeting started'), 'valueChange', false);
    await tapHeader();
    await act(async () => finish());
    expect(store.setTelegramNotification).toHaveBeenCalledWith('meeting_started', false);
    await tapHeader();
    expect(screen.getByLabelText('Meeting started').props.disabled).toBeFalsy();
  });

  it('an error is hidden when collapsed and still shows after expanding', async () => {
    setStore(
      fakeStore('S1', {
        telegram: linked(),
        setTelegramNotification: jest.fn().mockRejectedValue(new Error('Network request failed')),
      }),
    );
    await renderProfile();
    await fireEvent(screen.getByLabelText('Chat messages'), 'valueChange', false);
    expect(screen.getByText('Network request failed')).toBeTruthy();
    await tapHeader();
    expect(screen.queryByText('Network request failed')).toBeNull();
    await tapHeader();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  it('storage failure: expanded, toggle works for the session, no error shown', async () => {
    // The package's jest mock: these are already jest.fn()s.
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    expect(isCollapsed()).toBe(false);
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
    await tapHeader();
    await act(async () => {});
    expect(isCollapsed()).toBe(true);
    expect(screen.queryByText('disk')).toBeNull();
  });

  it('a quick double tap ends consistent', async () => {
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    await tapHeader();
    await tapHeader();
    expect(isCollapsed()).toBe(false);
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
  });

  it('no bot username: no card and no toggle', async () => {
    delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
    setStore(fakeStore('S1', { telegram: null }));
    await renderProfile();
    expect(screen.queryByRole('button', { name: 'Telegram notifications' })).toBeNull();
  });
});
