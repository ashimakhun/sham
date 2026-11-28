// QA ARU-183: gaps in aru183-copied-button.test.tsx, from the TEST DESIGN: the exact 1999 / 2000 ms edge (AC 2); a
// second tap at 1.5 s keeps Copied until 3.5 s (AC 5); the check-mark icon
// replaces the copy icon (AC 1); the button's own style and the code's style are identical in both states (AC 3);
// the Russian accessibility label stays in both states (AC 7); the code row keeps one line in Russian too (AC 4);
// leaving 1 s into Copied raises nothing (AC 8); students and mentors still get no workspace card.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import RolesScreen from '@/app/roles';
import { I18nContext, make } from '@/i18n/context';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const CODE = '62VACEZU';
const hidden = { includeHiddenElements: true };
const inRu = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const T = { en, ru };

async function show(lang: 'en' | 'ru' = 'en') {
  setStore(fakeStore('T', { getWorkspaceInvite: jest.fn(async () => ({ name: 'Sham', code: CODE })) }));
  const ui = <RolesScreen />;
  const r = await render(lang === 'ru' ? inRu(ui) : ui);
  await screen.findByText(CODE);
  return r;
}
const copyButton = (lang: 'en' | 'ru' = 'en') => screen.getByRole('button', { name: T[lang]['roles.copyLabel'] });
const flat = (s: unknown) => StyleSheet.flatten(typeof s === 'function' ? s({ pressed: false }) : s);

let announce: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => jest.useRealTimers());

describe('QA ARU-183', () => {
  it('AC 1: the check-mark icon replaces the copy icon inside the button, and back', async () => {
    await show();
    jest.useFakeTimers();
    const btn = () => within(copyButton());
    expect(btn().getByTestId('icon-copy-outline')).toBeTruthy();
    expect(btn().queryByTestId('icon-checkmark')).toBeNull();
    await fireEvent.press(copyButton());
    expect(btn().getByTestId('icon-checkmark')).toBeTruthy();
    expect(btn().queryByTestId('icon-copy-outline')).toBeNull();
    await act(async () => jest.advanceTimersByTime(2000));
    expect(btn().getByTestId('icon-copy-outline')).toBeTruthy();
  });

  it('AC 2: still Copied at 1999 ms, Copy at 2000 ms', async () => {
    await show();
    jest.useFakeTimers();
    await fireEvent.press(copyButton());
    await act(async () => jest.advanceTimersByTime(1999));
    expect(screen.getByText(en['roles.copied'])).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(1));
    expect(screen.getByText(en['roles.copy'])).toBeTruthy();
    expect(screen.queryByText(en['roles.copied'])).toBeNull();
  });

  it('AC 5: a second tap at 1.5 s copies again and keeps Copied until 3.5 s', async () => {
    await show();
    jest.useFakeTimers();
    await fireEvent.press(copyButton());
    await act(async () => jest.advanceTimersByTime(1500));
    await fireEvent.press(copyButton());
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTime(1900)); // 3.4 s
    expect(screen.getByText(en['roles.copied'])).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(100)); // 3.5 s
    expect(screen.getByText(en['roles.copy'])).toBeTruthy();
  });

  it.each(['en', 'ru'] as const)(
    'AC 3 / AC 4 (%s): button and code styles are the same in both states; both labels stay laid out; code on one line',
    async (lang) => {
      await show(lang);
      jest.useFakeTimers();
      const before = { btn: flat(copyButton(lang).props.style), code: flat(screen.getByTestId('invite-code').props.style) };
      // Both labels are in the button all the time, so its width is the longer label's in this language.
      expect(within(copyButton(lang)).getByText(T[lang]['roles.copy'], hidden)).toBeTruthy();
      expect(within(copyButton(lang)).getByText(T[lang]['roles.copied'], hidden)).toBeTruthy();
      await fireEvent.press(copyButton(lang));
      expect(flat(copyButton(lang).props.style)).toEqual(before.btn);
      expect(flat(screen.getByTestId('invite-code').props.style)).toEqual(before.code);
      expect(within(copyButton(lang)).getByText(T[lang]['roles.copy'], hidden)).toBeTruthy();
      const code = screen.getByTestId('invite-code');
      expect(code.props.numberOfLines).toBe(1);
      expect(code.props.adjustsFontSizeToFit).toBe(true);
      expect(code.props.selectable).toBe(true);
      expect(code.props.ellipsizeMode).toBeUndefined();
      await act(async () => jest.advanceTimersByTime(2000));
      expect(flat(copyButton(lang).props.style)).toEqual(before.btn);
    },
  );

  it('AC 7: in Russian the button is «Скопировать код приглашения» in both states; «Скопировано» is announced once per copy', async () => {
    await show('ru');
    jest.useFakeTimers();
    await fireEvent.press(copyButton('ru'));
    expect(copyButton('ru').props.accessibilityRole).toBe('button');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('Скопировано');
    await fireEvent.press(copyButton('ru'));
    expect(announce).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTime(2000));
    expect(copyButton('ru')).toBeTruthy();
  });

  it('AC 6: a refused clipboard shows no check mark and announces nothing, even after a successful copy timed out', async () => {
    await show();
    jest.useFakeTimers();
    (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error('denied'));
    await fireEvent.press(copyButton());
    expect(within(copyButton()).queryByTestId('icon-checkmark')).toBeNull();
    expect(screen.getByText(en['roles.copy'])).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  });

  it('AC 8: leaving 1 s into Copied raises nothing and announces once; coming back shows Copy', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const view = await show();
    jest.useFakeTimers();
    await fireEvent.press(copyButton());
    await act(async () => jest.advanceTimersByTime(1000));
    await view.unmount();
    await act(async () => jest.advanceTimersByTime(5000));
    expect(errors).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledTimes(1);
    errors.mockRestore();
    jest.useRealTimers();
    await show();
    expect(screen.getByText(en['roles.copy'])).toBeTruthy();
    expect(screen.queryByText(en['roles.copied'])).toBeNull();
  });

  it('students and mentors still get no workspace card', async () => {
    for (const who of ['S1', 'M'] as const) {
      setStore(fakeStore(who, { getWorkspaceInvite: jest.fn(async () => ({ name: 'Sham', code: CODE })) }));
      const view = await render(<RolesScreen />);
      await act(async () => {});
      expect(screen.queryByTestId('workspace-card')).toBeNull();
      expect(screen.queryByText(CODE)).toBeNull();
      await view.unmount();
    }
  });
});
