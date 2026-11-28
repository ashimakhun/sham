// ARU-202 QA (re-test of the fix on PR #178): the sign-in screen after a sign-out in the same visit uses the language
// last shown on this device (ARU-108 AC 6), which is the signed-in account's language once it has taken over
// (ARU-189 AC 4). Also: a storage read that finishes after an account loaded never replaces the account's language,
// and the signed-out paths that read storage still work. The ARU-202 reproduction is in
// __tests__/aru189-signup-language-qa.test.tsx; ARU-108 rules are in __tests__/aru108-i18n.test.tsx.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Localization from 'expo-localization';
import type { ReactNode } from 'react';
import { Text } from 'react-native';

import SignInScreen from '@/app/index';
import { useFormLanguage } from '@/i18n/context';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import { FORM_LANGUAGE_KEY, LAST_LANGUAGE_KEY, LanguageProvider, useI18n } from '@/i18n/LanguageProvider';
import type { User } from '@/lib/types';

import { tickAgree } from './helpers/agree';
import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en' }]) }));

const locales = Localization.getLocales as jest.Mock;
const phone = (tag: string) => locales.mockReturnValue([{ languageTag: tag, languageCode: tag.split('-')[0] }]);

const wrap = (child: ReactNode) => <LanguageProvider>{child}</LanguageProvider>;
const flush = () => act(async () => {});
const signedIn = (language?: 'en' | 'ru') => {
  const me: User = { ...users.T, language };
  setStore(fakeStore('T', { currentUser: me }));
};
const signedOut = (over = {}) => setStore(fakeStore(null, over));

/** The language now shown and the form's pick, while signed in (the sign-in screen isn't shown then). */
function Probe() {
  const { lang } = useI18n();
  const { picked } = useFormLanguage();
  return <Text testID="probe">{`${lang}/${picked ?? 'none'}`}</Text>;
}
const shown = () => screen.getByTestId('probe').props.children;
const signInIs = (lang: 'en' | 'ru') => {
  const [want, other] = lang === 'en' ? [en, ru] : [ru, en];
  expect(screen.getByText(want['signIn.tagline'])).toBeTruthy();
  expect(screen.queryByText(other['signIn.tagline'])).toBeNull();
};

/** AsyncStorage.getItem held until release(): a slow storage read at app start. */
function slowStorage(values: Record<string, string>) {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  // The async-storage jest mock's getItem is already a jest.fn: keep its implementation to put it back afterwards
  // (mockRestore would leave it with none).
  const getItem = AsyncStorage.getItem as jest.Mock;
  const original = getItem.getMockImplementation();
  getItem.mockImplementation(async (key: string) => {
    await gate;
    return values[key] ?? null;
  });
  return {
    release: async () => {
      await act(async () => release());
      await flush();
      getItem.mockImplementation(original);
    },
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  phone('en-US');
  await AsyncStorage.clear();
});

describe('ARU-108 AC 6: sign out in the same visit, the language last shown', () => {
  it('English phone, Russian account, sign out without reopening: the sign-in screen stays Russian', async () => {
    signedIn('ru');
    const view = await render(wrap(<Probe />));
    await flush();
    expect(shown()).toBe('ru/none');
    signedOut();
    await view.rerender(wrap(<SignInScreen />));
    await flush();
    signInIs('ru');
    expect(await AsyncStorage.getItem(LAST_LANGUAGE_KEY)).toBe('ru');
  });

  it('storage had ru at app start (no form pick), sign in to an English account, sign out: English (the main-path case of ARU-202)', async () => {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, 'ru');
    signedOut();
    const view = await render(wrap(<SignInScreen />));
    await flush();
    signInIs('ru');
    signedIn('en');
    await view.rerender(wrap(<Probe />));
    await flush();
    expect(shown()).toBe('en/none');
    signedOut();
    await view.rerender(wrap(<SignInScreen />));
    await flush();
    signInIs('en');
  });

  it('an account that never chose shows the phone language; after sign-out that is the language last shown', async () => {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, 'ru');
    signedOut();
    const view = await render(wrap(<SignInScreen />));
    await flush();
    signInIs('ru');
    signedIn(undefined);
    await view.rerender(wrap(<Probe />));
    await flush();
    expect(shown()).toBe('en/none');
    signedOut();
    await view.rerender(wrap(<SignInScreen />));
    await flush();
    signInIs('en');
    expect(await AsyncStorage.getItem(LAST_LANGUAGE_KEY)).toBe('en');
  });

  it('the Profile switch changed the account language before sign-out: the sign-in screen uses the new one', async () => {
    signedIn('en');
    const view = await render(wrap(<Probe />));
    await flush();
    expect(shown()).toBe('en/none');
    signedIn('ru'); // the account's saved language after the Profile switch
    await view.rerender(wrap(<Probe />));
    await flush();
    expect(shown()).toBe('ru/none');
    signedOut();
    await view.rerender(wrap(<SignInScreen />));
    await flush();
    signInIs('ru');
  });

  it('two accounts in a row: Russian, sign out, English, sign out: English', async () => {
    signedIn('ru');
    const view = await render(wrap(<Probe />));
    await flush();
    signedOut();
    await view.rerender(wrap(<SignInScreen />));
    await flush();
    signInIs('ru');
    signedIn('en');
    await view.rerender(wrap(<Probe />));
    await flush();
    signedOut();
    await view.rerender(wrap(<SignInScreen />));
    await flush();
    signInIs('en');
  });
});

describe('a late storage read never overwrites the account language', () => {
  it('storage (ru, and a ru form pick) is read after an English account loaded: English stays, no pick, and after sign-out English', async () => {
    const storage = slowStorage({ [LAST_LANGUAGE_KEY]: 'ru', [FORM_LANGUAGE_KEY]: 'ru' });
    signedIn('en');
    const view = await render(wrap(<Probe />));
    await flush();
    expect(shown()).toBe('en/none');
    await storage.release();
    expect(shown()).toBe('en/none');
    const signUp = jest.fn(async () => {});
    signedOut({ signUp });
    await view.rerender(wrap(<SignInScreen />));
    await flush();
    signInIs('en');
    // ARU-189 AC 4 / AC 7: the stale pick was replaced, so it isn't selected or sent on a later sign-up.
    await fireEvent.press(screen.getByText('Create account'));
    expect(screen.getByRole('radio', { name: 'English' }).props.accessibilityState.checked).toBe(true);
    await fireEvent.changeText(screen.getByPlaceholderText(/Dana S\./), 'Dana');
    await fireEvent.changeText(screen.getByTestId('username-field'), 'dana_s');
    await fireEvent.changeText(screen.getByPlaceholderText(/At least 6 characters/), 'secret1');
    await fireEvent.press(screen.getByRole('tab', { name: /Join a workspace/ }));
    await fireEvent.changeText(screen.getByPlaceholderText(/8 letters and digits/), 'ABCD2345');
    await tickAgree();
    await fireEvent.press(screen.getByRole('button', { name: /^Create account$/ }));
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp.mock.calls[0]).toHaveLength(4);
    expect(await AsyncStorage.getItem(LAST_LANGUAGE_KEY)).toBe('en');
    expect(await AsyncStorage.getItem(FORM_LANGUAGE_KEY)).toBeNull();
  });

  it('signed out, a slow storage read still applies when it finishes (ARU-108 AC 6 after a reopen)', async () => {
    const storage = slowStorage({ [LAST_LANGUAGE_KEY]: 'ru' });
    signedOut();
    await render(wrap(<SignInScreen />));
    await flush();
    signInIs('en'); // the phone until storage answers
    await storage.release();
    signInIs('ru');
  });

  it('signed out, a slow read of a form pick from an earlier visit still shows it and counts as picked (ARU-189 AC 4)', async () => {
    const storage = slowStorage({ [LAST_LANGUAGE_KEY]: 'ru', [FORM_LANGUAGE_KEY]: 'ru' });
    signedOut();
    await render(wrap(<Probe />));
    await storage.release();
    expect(shown()).toBe('ru/ru');
  });
});

describe('ARU-189 AC 4: after sign-out the form switch works again', () => {
  it('English account signs out, pick Русский: the form is Russian and Русский is sent with sign-up', async () => {
    signedIn('en');
    const view = await render(wrap(<Probe />));
    await flush();
    const signUp = jest.fn(async () => {});
    const setLanguage = jest.fn(async () => {});
    signedOut({ signUp, setLanguage });
    await view.rerender(wrap(<SignInScreen />));
    await flush();
    signInIs('en');
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Русский' }));
    signInIs('ru');
    expect(await AsyncStorage.getItem(FORM_LANGUAGE_KEY)).toBe('ru');
    await fireEvent.changeText(screen.getByPlaceholderText(/Дана С\./), 'Dana');
    await fireEvent.changeText(screen.getByTestId('username-field'), 'dana_s');
    await fireEvent.changeText(screen.getByPlaceholderText(/Не менее 6 символов/), 'secret1');
    await fireEvent.press(screen.getByRole('tab', { name: /Присоединиться/ }));
    await fireEvent.changeText(screen.getByPlaceholderText(/8 букв и цифр/), 'ABCD2345');
    await tickAgree();
    await fireEvent.press(screen.getByRole('button', { name: /^Создать аккаунт$/ }));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith('Dana', 'dana_s', 'secret1', { kind: 'join', code: 'ABCD2345' }, 'ru'),
    );
    expect(setLanguage).not.toHaveBeenCalled();
  });
});
