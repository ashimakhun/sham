// ARU-189 QA: the Create account form's Language switch, the cases the dev tests don't cover: Forgot password uses the
// pick (AC 4), the waiting screen of a new pending student is in the saved language from the first frame (AC 5), an
// existing account's saved language wins over the pick and nothing is saved on it (AC 6), offline / taken-username
// failures keep the pick and a retry still sends it (AC 8), a tap before storage was read wins, and the pick survives
// going to Sign in and back. Dev tests: __tests__/aru189-signup-language.test.tsx.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import SignInScreen from '@/app/index';
import ForgotPasswordScreen from '@/app/forgot-password';
import { AccessGate } from '@/components/AccessGate';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import { FORM_LANGUAGE_KEY, LAST_LANGUAGE_KEY, LanguageProvider } from '@/i18n/LanguageProvider';
import type { User } from '@/lib/types';

import { tickAgree } from './helpers/agree';
import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en' }]) }));

const wrap = (child: ReactNode) => <LanguageProvider>{child}</LanguageProvider>;
const radio = (name: string) => screen.getByRole('radio', { name });

async function fillJoin(code = 'ABCD2345') {
  await fireEvent.changeText(screen.getByPlaceholderText(/Dana S\.|Дана С\./), 'Dana');
  await fireEvent.changeText(screen.getByTestId('username-field'), 'dana_s');
  await fireEvent.changeText(screen.getByPlaceholderText(/At least 6 characters|Не менее 6 символов/), 'secret1');
  await fireEvent.press(screen.getByRole('tab', { name: /Join a workspace|Присоединиться/ }));
  await fireEvent.changeText(screen.getByPlaceholderText(/8 letters and digits|8 букв и цифр/), code);
  await tickAgree();
}
const createButton = () => screen.getByRole('button', { name: /^(Create account|Создать аккаунт)$/ });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('AC 4: Forgot password uses the pick', () => {
  it('picked in this visit: Forgot password opens in Russian', async () => {
    setStore(fakeStore(null));
    const view = await render(wrap(<SignInScreen />));
    await act(async () => {});
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(radio('Русский'));
    await view.rerender(wrap(<ForgotPasswordScreen />));
    expect(screen.getByText(ru['forgot.codeHint'])).toBeTruthy();
    expect(screen.queryByText(en['forgot.codeHint'])).toBeNull();
  });

  it('picked in an earlier visit: after reopening, Forgot password opens in Russian', async () => {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, 'ru');
    await AsyncStorage.setItem(FORM_LANGUAGE_KEY, 'ru');
    setStore(fakeStore(null));
    await render(wrap(<ForgotPasswordScreen />));
    await act(async () => {});
    expect(screen.getByText(ru['forgot.codeHint'])).toBeTruthy();
  });
});

describe('AC 4: the pick survives Sign in and back', () => {
  it('pick Русский, go to Sign in, back to Create account: Русский still selected and sent', async () => {
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await render(wrap(<SignInScreen />));
    await act(async () => {});
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(radio('Русский'));
    await fireEvent.press(screen.getByRole('tab', { name: ru['signIn.modeSignIn'] }));
    expect(screen.queryByTestId('signup-language-switch')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: ru['signIn.modeSignUp'] }));
    expect(radio('Русский').props.accessibilityState.checked).toBe(true);
    await fillJoin();
    await fireEvent.press(createButton());
    await waitFor(() => expect(signUp).toHaveBeenCalledWith('Dana', 'dana_s', 'secret1', { kind: 'join', code: 'ABCD2345' }, 'ru'));
  });

  it('a tap made before storage was read wins over what storage had', async () => {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, 'en');
    await AsyncStorage.setItem(FORM_LANGUAGE_KEY, 'en');
    const original = AsyncStorage.getItem;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    AsyncStorage.getItem = jest.fn(async (k: string) => {
      await gate;
      return original(k);
    }) as typeof AsyncStorage.getItem;
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await render(wrap(<SignInScreen />));
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(radio('Русский'));
    await act(async () => release());
    await act(async () => {});
    AsyncStorage.getItem = original;
    expect(radio('Русский').props.accessibilityState.checked).toBe(true);
    expect(screen.getByText(ru['signIn.tagline'])).toBeTruthy();
    await fillJoin();
    await fireEvent.press(createButton());
    await waitFor(() => expect(signUp).toHaveBeenCalledWith('Dana', 'dana_s', 'secret1', { kind: 'join', code: 'ABCD2345' }, 'ru'));
  });
});

describe('AC 5: a new pending student sees the waiting screen in the saved language at once', () => {
  it('English phone, account saved with ru: the first frame is Russian', async () => {
    const pending: User = { ...users.S1, accessStatus: 'pending', language: 'ru' };
    setStore(fakeStore('S1', { currentUser: pending }));
    await render(wrap(<AccessGate>{null}</AccessGate>));
    // No act() for the storage read: the first frame already uses the account's language.
    expect(screen.getByText(ru['gate.waitingTitle'])).toBeTruthy();
    expect(screen.queryByText(en['gate.waitingTitle'])).toBeNull();
  });
});

describe('AC 6: an existing account keeps its own language; nothing is saved on it', () => {
  async function pickThenSignIn(pick: 'English' | 'Русский', account: User) {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, pick === 'English' ? 'ru' : 'en');
    const setLanguage = jest.fn(async () => {});
    setStore(fakeStore(null, { setLanguage }));
    const view = await render(wrap(<SignInScreen />));
    await act(async () => {});
    await fireEvent.press(screen.getByText(/^(Create account|Регистрация)$/));
    await fireEvent.press(radio(pick));
    setStore(fakeStore(account.id as 'T', { currentUser: account, setLanguage }));
    await view.rerender(wrap(<ForgotPasswordScreen />));
    await act(async () => {});
    return { setLanguage, view };
  }

  it('pick Русский, sign in to an account saved with en: English, and no save', async () => {
    const { setLanguage } = await pickThenSignIn('Русский', { ...users.T, language: 'en' });
    expect(screen.getByText(en['forgot.codeHint'])).toBeTruthy();
    expect(setLanguage).not.toHaveBeenCalled();
    await waitFor(async () => expect(await AsyncStorage.getItem(FORM_LANGUAGE_KEY)).toBeNull());
  });

  it('pick English, sign in to an account saved with ru: Russian, and no save', async () => {
    const { setLanguage } = await pickThenSignIn('English', { ...users.T, language: 'ru' });
    expect(screen.getByText(ru['forgot.codeHint'])).toBeTruthy();
    expect(setLanguage).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(LAST_LANGUAGE_KEY)).toBe('ru');
  });

  it('after that account signs out, the sign-in screen no longer counts the old pick (not sent on a later sign-up)', async () => {
    const { view } = await pickThenSignIn('Русский', { ...users.T, language: 'en' });
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await view.rerender(wrap(<SignInScreen />));
    await act(async () => {});
    await fireEvent.press(screen.getByText(/^(Create account|Регистрация)$/));
    await fillJoin();
    await fireEvent.press(createButton());
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    // AC 7: the switch wasn't touched since the account replaced the pick.
    expect(signUp.mock.calls[0]).toHaveLength(4);
  });
});

describe('AC 4: after an account replaced the pick and signs out', () => {
  it("the sign-in screen shows the account's language (last shown), not the replaced pick", async () => {
    setStore(fakeStore(null));
    const view = await render(wrap(<SignInScreen />));
    await act(async () => {});
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(radio('Русский'));
    // Sign in to an existing account saved with en: the app is English (AC 6).
    setStore(fakeStore('T', { currentUser: { ...users.T, language: 'en' } }));
    await view.rerender(wrap(<ForgotPasswordScreen />));
    await act(async () => {});
    expect(screen.getByText(en['forgot.codeHint'])).toBeTruthy();
    expect(await AsyncStorage.getItem(LAST_LANGUAGE_KEY)).toBe('en');
    // Sign out, same visit.
    setStore(fakeStore(null));
    await view.rerender(wrap(<SignInScreen />));
    await act(async () => {});
    // AC 4: the pick counts only "until a signed-in account's language replaces it"; ARU-108 AC 6: the language last shown.
    expect(screen.getByText(en['signIn.tagline'])).toBeTruthy();
  });
});

describe('AC 8: a failed sign-up keeps the pick and everything typed', () => {
  it.each([
    ['offline', en['auth.network'], ru['auth.network']],
    ['username taken', en['auth.usernameTaken'], ru['auth.usernameTaken']],
  ])('%s: the error is in Russian, fields kept, and the retry still sends ru', async (_case, enMsg, ruMsg) => {
    const signUp = jest
      .fn<Promise<void>, unknown[]>()
      .mockRejectedValueOnce(new Error(enMsg))
      .mockResolvedValueOnce(undefined);
    setStore(fakeStore(null, { signUp: signUp as never }));
    await render(wrap(<SignInScreen />));
    await act(async () => {});
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(radio('Русский'));
    await fillJoin();
    await fireEvent.press(createButton());
    expect(await screen.findByText(ruMsg)).toBeTruthy();
    expect(screen.queryByText(enMsg)).toBeNull();
    expect(radio('Русский').props.accessibilityState.checked).toBe(true);
    expect(screen.getByPlaceholderText(ru['signIn.displayNamePlaceholder']).props.value).toBe('Dana');
    expect(screen.getByTestId('username-field').props.value).toBe('dana_s');
    expect(screen.getByPlaceholderText(ru['signIn.inviteCodePlaceholder']).props.value).toBe('ABCD2345');
    expect(screen.getByTestId('legal-agree-checkbox').props.accessibilityState.checked).toBe(true);
    await fireEvent.press(createButton());
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(2));
    expect(signUp.mock.calls[1]).toEqual(['Dana', 'dana_s', 'secret1', { kind: 'join', code: 'ABCD2345' }, 'ru']);
  });
});
