// ARU-189: the Create account form's Language switch. Shown only on Create account; switching re-renders the form at
// once and keeps everything typed; the pick is remembered on this device (with the form's own key, so a pick from an
// earlier visit still counts) and sent with the sign-up only when touched; signing in never sends one. Database rules:
// supabase/tests/aru189_signup_language.test.sql. Store: __tests__/aru189-store-signup-language.test.tsx.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import SignInScreen from '@/app/index';
import en from '@/i18n/en.json';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';
import { useI18n } from '@/i18n/context';
import { FORM_LANGUAGE_KEY, LAST_LANGUAGE_KEY, LanguageProvider } from '@/i18n/LanguageProvider';
import type { User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';
import { tickAgree } from './helpers/agree';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en' }]) }));

async function mount() {
  await render(
    <LanguageProvider>
      <SignInScreen />
    </LanguageProvider>,
  );
  await act(async () => {}); // storage read
}
const radio = (name: string) => screen.getByRole('radio', { name });
const switchShown = () => screen.queryByTestId('signup-language-switch');

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('AC 1 / AC 2: only on Create account, under the selector, above Display name', () => {
  it('absent on Sign in; shown on Create account with the language now shown selected; gone again on Sign in', async () => {
    setStore(fakeStore(null));
    await mount();
    expect(switchShown()).toBeNull();
    await fireEvent.press(screen.getByText('Create account'));
    expect(switchShown()).toBeTruthy();
    expect(screen.getByText('Language')).toBeTruthy();
    expect(radio('English').props.accessibilityState).toEqual({ checked: true, disabled: false });
    expect(radio('Русский').props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(JSON.stringify(screen.toJSON())).toContain('"accessibilityRole":"radiogroup"');
    await fireEvent.press(screen.getByRole('tab', { name: 'Sign in' }));
    expect(switchShown()).toBeNull();
  });

  it('sits between the Sign in / Create account selector and the display name field', async () => {
    setStore(fakeStore(null));
    await mount();
    await fireEvent.press(screen.getByText('Create account'));
    const json = JSON.stringify(screen.toJSON());
    const selector = json.indexOf('"tablist"');
    const sw = json.indexOf('signup-language-switch');
    const display = json.indexOf('Display name');
    expect(selector).toBeGreaterThan(-1);
    expect(selector).toBeLessThan(sw);
    expect(sw).toBeLessThan(display);
  });

  it('each option is written in its own language, in both languages', async () => {
    setStore(fakeStore(null));
    await mount();
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(radio('Русский'));
    expect(screen.getByText('Язык')).toBeTruthy();
    expect(radio('English')).toBeTruthy();
    expect(radio('Русский').props.accessibilityState.checked).toBe(true);
  });
});

describe('AC 3: switches at once and clears nothing', () => {
  it('every text changes; typed fields, the Join choice, its code and the agreement tick stay', async () => {
    setStore(fakeStore(null));
    await mount();
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.changeText(screen.getByPlaceholderText('Dana S.'), 'Dana');
    await fireEvent.changeText(screen.getByPlaceholderText('dana_s'), 'dana_s');
    await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
    await fireEvent.press(screen.getByRole('tab', { name: 'Join a workspace' }));
    await fireEvent.changeText(screen.getByPlaceholderText('8 letters and digits'), 'ABCD2345');
    await tickAgree();

    await fireEvent.press(radio('Русский'));
    expect(screen.getByText(ru['signIn.tagline'])).toBeTruthy();
    expect(screen.getByRole('tab', { name: ru['signIn.modeSignUp'] })).toBeTruthy();
    expect(screen.getByText(ru['signIn.displayName'])).toBeTruthy();
    expect(screen.getByPlaceholderText(ru['signIn.displayNamePlaceholder']).props.value).toBe('Dana');
    expect(screen.getByPlaceholderText(ru['signIn.usernamePlaceholder']).props.value).toBe('dana_s');
    expect(screen.getByPlaceholderText('Не менее 6 символов').props.value).toBe('secret1');
    expect(screen.getByRole('tab', { name: ru['signIn.workspaceJoin'] }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByPlaceholderText(ru['signIn.inviteCodePlaceholder']).props.value).toBe('ABCD2345');
    expect(screen.getByTestId('legal-agree-checkbox').props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('button', { name: ru['signIn.createAccount'] })).toBeEnabled();
    expect(screen.queryByText(en['signIn.tagline'])).toBeNull();
  });

  it('a shown error re-renders in the picked language, the username hint too', async () => {
    const signUp = jest.fn(async () => {
      throw new Error('No workspace has this invite code.');
    });
    setStore(fakeStore(null, { signUp }));
    await mount();
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.changeText(screen.getByPlaceholderText('Dana S.'), 'Dana');
    await fireEvent.changeText(screen.getByPlaceholderText('dana_s'), 'dana_s');
    await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
    await fireEvent.press(screen.getByRole('tab', { name: 'Join a workspace' }));
    await fireEvent.changeText(screen.getByPlaceholderText('8 letters and digits'), 'ZZZZZZZZ');
    await tickAgree();
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('No workspace has this invite code.')).toBeTruthy();
    await fireEvent.press(radio('Русский'));
    // AC 8: the error in the picked language, everything kept.
    expect(screen.getByText('Нет рабочего пространства с этим кодом приглашения.')).toBeTruthy();
    expect(screen.getByPlaceholderText(ru['signIn.displayNamePlaceholder']).props.value).toBe('Dana');
    await fireEvent.changeText(screen.getByPlaceholderText(ru['signIn.usernamePlaceholder']), 'a');
    expect(screen.getByText(ru['signIn.usernameRule'])).toBeTruthy();
  });
});

describe('AC 4: remembered on this device before signing up', () => {
  it('Sign in uses the pick; it is stored under both keys', async () => {
    setStore(fakeStore(null));
    await mount();
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(radio('Русский'));
    await fireEvent.press(screen.getByRole('tab', { name: ru['signIn.modeSignIn'] }));
    expect(screen.getByText(ru['signIn.forgotPassword'])).toBeTruthy();
    await waitFor(async () => expect(await AsyncStorage.getItem(LAST_LANGUAGE_KEY)).toBe('ru'));
    expect(await AsyncStorage.getItem(FORM_LANGUAGE_KEY)).toBe('ru');
  });

  it('reopening the app shows the pick, and Create account then still sends it (analysis note 2)', async () => {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, 'ru');
    await AsyncStorage.setItem(FORM_LANGUAGE_KEY, 'ru');
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await mount();
    expect(screen.getByText(ru['signIn.tagline'])).toBeTruthy();
    await fireEvent.press(screen.getByText(ru['signIn.modeSignUp']));
    expect(radio('Русский').props.accessibilityState.checked).toBe(true);
    await fireEvent.changeText(screen.getByPlaceholderText(ru['signIn.displayNamePlaceholder']), 'Аня');
    await fireEvent.changeText(screen.getByPlaceholderText(ru['signIn.usernamePlaceholder']), 'anya');
    await fireEvent.changeText(screen.getByPlaceholderText('Не менее 6 символов'), 'secret1');
    await fireEvent.press(screen.getByRole('tab', { name: ru['signIn.workspaceCreate'] }));
    await fireEvent.changeText(screen.getByPlaceholderText(ru['signIn.workspaceNamePlaceholder']), 'Школа');
    await tickAgree();
    await fireEvent.press(screen.getByRole('button', { name: ru['signIn.createAccount'] }));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith('Аня', 'anya', 'secret1', { kind: 'create', name: 'Школа' }, 'ru'),
    );
  });

  it('storage unavailable: the switch still works for this visit and is still sent', async () => {
    const original = AsyncStorage.setItem;
    AsyncStorage.setItem = jest.fn(() => Promise.reject(new Error('no storage')));
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await mount();
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(radio('Русский'));
    expect(screen.getByText(ru['signIn.tagline'])).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText(ru['signIn.displayNamePlaceholder']), 'Dana');
    await fireEvent.changeText(screen.getByPlaceholderText(ru['signIn.usernamePlaceholder']), 'dana_s');
    await fireEvent.changeText(screen.getByPlaceholderText('Не менее 6 символов'), 'secret1');
    await fireEvent.press(screen.getByRole('tab', { name: ru['signIn.workspaceJoin'] }));
    await fireEvent.changeText(screen.getByPlaceholderText(ru['signIn.inviteCodePlaceholder']), 'ABCD2345');
    await tickAgree();
    await fireEvent.press(screen.getByRole('button', { name: ru['signIn.createAccount'] }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith('Dana', 'dana_s', 'secret1', { kind: 'join', code: 'ABCD2345' }, 'ru'));
    AsyncStorage.setItem = original;
  });
});

describe('AC 5 / AC 7: sent with the sign-up only when touched', () => {
  async function fillAndSubmit() {
    await fireEvent.changeText(screen.getByPlaceholderText(/Dana S\.|Дана С\./), 'Dana');
    await fireEvent.changeText(screen.getByTestId('username-field'), 'dana_s');
    await fireEvent.changeText(screen.getByPlaceholderText(/At least 6 characters|Не менее 6 символов/), 'secret1');
    await fireEvent.press(screen.getByRole('tab', { name: /Join a workspace|Присоединиться/ }));
    await fireEvent.changeText(screen.getByPlaceholderText(/8 letters and digits|8 букв и цифр/), 'ABCD2345');
    await tickAgree();
    await fireEvent.press(screen.getByRole('button', { name: /^(Create account|Создать аккаунт)$/ }));
  }

  it('not touched: no language is sent', async () => {
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await mount();
    await fireEvent.press(screen.getByText('Create account'));
    await fillAndSubmit();
    await waitFor(() => expect(signUp).toHaveBeenCalledWith('Dana', 'dana_s', 'secret1', { kind: 'join', code: 'ABCD2345' }));
    expect(signUp.mock.calls[0]).toHaveLength(4);
  });

  it('not touched, but sham.language is Russian from an earlier account: still nothing sent (AC 7)', async () => {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, 'ru');
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await mount();
    expect(screen.getByText(ru['signIn.tagline'])).toBeTruthy();
    await fireEvent.press(screen.getByText(ru['signIn.modeSignUp']));
    await fillAndSubmit();
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp.mock.calls[0]).toHaveLength(4);
  });

  it('picked English on a Russian device: English is sent; the last tap wins', async () => {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, 'ru');
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await mount();
    await fireEvent.press(screen.getByText(ru['signIn.modeSignUp']));
    await fireEvent.press(radio('Русский'));
    await fireEvent.press(radio('English'));
    await fillAndSubmit();
    await waitFor(() => expect(signUp).toHaveBeenCalledWith('Dana', 'dana_s', 'secret1', { kind: 'join', code: 'ABCD2345' }, 'en'));
  });
});

describe('AC 6: signing in never sends or saves a language', () => {
  it('pick Russian, switch to Sign in, sign in: signIn gets only username and password', async () => {
    const signIn = jest.fn(async () => {});
    const setLanguage = jest.fn(async () => {});
    setStore(fakeStore(null, { signIn, setLanguage }));
    await mount();
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(radio('Русский'));
    await fireEvent.press(screen.getByRole('tab', { name: ru['signIn.modeSignIn'] }));
    await fireEvent.changeText(screen.getByTestId('username-field'), 'tess');
    await fireEvent.changeText(screen.getByPlaceholderText('Не менее 6 символов'), 'secret1');
    await fireEvent.press(screen.getByRole('button', { name: ru['signIn.submit'] }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('tess', 'secret1'));
    expect(setLanguage).not.toHaveBeenCalled();
  });

  it("the signed-in account's language replaces the pick, and the pick is forgotten", async () => {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, 'ru');
    await AsyncStorage.setItem(FORM_LANGUAGE_KEY, 'ru');
    let shown = '';
    function Probe() {
      shown = useI18n().lang;
      return <Text>probe</Text>;
    }
    setStore(fakeStore(null));
    const view = await render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await act(async () => {});
    expect(shown).toBe('ru');
    // An existing account that never chose, on an English phone: the phone language (ARU-108 AC 5).
    const tess: User = { ...users.T };
    setStore(fakeStore('T', { currentUser: tess }));
    await view.rerender(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await act(async () => {});
    expect(shown).toBe('en');
    await waitFor(async () => expect(await AsyncStorage.getItem(FORM_LANGUAGE_KEY)).toBeNull());
    expect(await AsyncStorage.getItem(LAST_LANGUAGE_KEY)).toBe('en');
  });
});

describe('AC 9: catalog', () => {
  it('signIn.language in all three files; the options reuse the Profile IDs', () => {
    expect(en['signIn.language']).toBe('Language');
    expect(ru['signIn.language']).toBe('Язык');
    expect(notes['signIn.language']).toMatch(/Create account form only/);
    expect(en['profile.languageEnglish']).toBe('English');
    expect(ru['profile.languageRussian']).toBe('Русский');
  });
});
