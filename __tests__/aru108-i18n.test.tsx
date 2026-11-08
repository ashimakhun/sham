// ARU-108 (Russian version, part 1): the language rules, plurals, dates, message translation, the Language switch
// and the part-1 screens in both languages.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Localization from 'expo-localization';
import { Text } from 'react-native';

import TabLayout from '@/app/(tabs)/_layout';
import ProfileScreen from '@/app/(tabs)/profile';
import ChangePasswordScreen from '@/app/change-password';
import SignInScreen from '@/app/index';
import ResetPasswordScreen from '@/app/reset-password';
import { AccessGate } from '@/components/AccessGate';
import {
  formatDateIn,
  formatDateTimeIn,
  formatWeekdayDateIn,
  languageFromLocale,
  phoneLanguage,
  pluralForm,
  translate,
  translateMessage,
} from '@/i18n';
import { LAST_LANGUAGE_KEY, LanguageProvider, useI18n } from '@/i18n/LanguageProvider';
import { authErrorMessage } from '@/lib/password';
import type { User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => {
  const base = require('./helpers/mocks').expoRouter;
  // The tab bar: each screen's title, as the tab label.
  const Tabs = ({ children }: { children: unknown }) => children;
  Tabs.Screen = ({ options }: { options: { title: string } }) => {
    const { Text: T } = require('react-native');
    return <T testID="tab-title">{options.title}</T>;
  };
  return { ...base, Tabs, Redirect: () => null };
});
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en' }]) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/components/Telegram', () => ({ TelegramButton: () => null }));
jest.mock('@/components/Accountant', () => ({ AccountantSection: () => null }));

const locales = Localization.getLocales as jest.Mock;
const phone = (tag: string) => locales.mockReturnValue([{ languageTag: tag, languageCode: tag.split('-')[0] }]);

/** A store signed in as `who`, with a language choice. */
const as = (who: keyof typeof users, language?: 'en' | 'ru', over = {}) => {
  const me: User = { ...users[who], language };
  return fakeStore(who, { currentUser: me, ...over });
};
const inApp = (ui: React.ReactElement) => <LanguageProvider>{ui}</LanguageProvider>;
/** Every text on screen, to look for a script that shouldn't be there. */
const allText = () => JSON.stringify(screen.toJSON());
const CYRILLIC = /[а-яё]/i;
const flush = () => act(async () => {});

beforeEach(async () => {
  jest.clearAllMocks();
  phone('en-US');
  await AsyncStorage.clear();
});

describe('AC 2 / AC 5: the phone language', () => {
  it.each([
    ['ru-RU', 'ru'],
    ['ru-KZ', 'ru'],
    ['ru-UA', 'ru'],
    ['ru', 'ru'],
    ['RU-ru', 'ru'],
    ['en-US', 'en'],
    ['kk-KZ', 'en'],
    ['uk-UA', 'en'],
    ['de-DE', 'en'],
    ['rus', 'en'],
    ['', 'en'],
  ])('%s → %s', (tag, lang) => {
    expect(languageFromLocale(tag)).toBe(lang);
  });

  it('reads the phone through expo-localization, English if it fails', () => {
    phone('ru-KZ');
    expect(phoneLanguage()).toBe('ru');
    locales.mockImplementationOnce(() => {
      throw new Error('no native module');
    });
    expect(phoneLanguage()).toBe('en');
  });
});

describe('AC 9: plurals and dates', () => {
  it.each([
    [1, 'one', '1 домашнее задание'],
    [2, 'few', '2 домашних задания'],
    [5, 'many', '5 домашних заданий'],
    [11, 'many', '11 домашних заданий'],
    [12, 'many', '12 домашних заданий'],
    [21, 'one', '21 домашнее задание'],
    [22, 'few', '22 домашних задания'],
    [0, 'many', '0 домашних заданий'],
    [111, 'many', '111 домашних заданий'],
  ])('Russian %i → %s: %s', (n, form, text) => {
    expect(pluralForm('ru', n)).toBe(form);
    expect(translate('ru', 'common.homeworkCount', { count: n })).toBe(text);
  });

  it('English: one and other', () => {
    expect(pluralForm('en', 1)).toBe('one');
    expect(pluralForm('en', 2)).toBe('other');
    expect(translate('en', 'common.homeworkCount', { count: 2 })).toBe('2 homework');
  });

  const may12 = new Date('2026-05-12T14:05:00Z');
  it('Russian dates: "12 мая 2026", "вт, 12 мая"', () => {
    expect(formatDateIn('ru', may12, 'UTC')).toBe('12 мая 2026');
    expect(formatWeekdayDateIn('ru', may12, 'UTC')).toBe('вт, 12 мая');
    expect(formatDateTimeIn('ru', may12, 'UTC')).toBe('12 мая 2026, 14:05');
  });

  it('English dates: "12 May 2026", "Tue, 12 May", whatever the phone locale', () => {
    phone('ru-RU');
    expect(formatDateIn('en', may12, 'UTC')).toBe('12 May 2026');
    expect(formatWeekdayDateIn('en', may12, 'UTC')).toBe('Tue, 12 May');
    expect(formatDateTimeIn('en', '2026-05-12T14:05:00Z', 'UTC')).toBe('12 May 2026, 14:05');
  });
});

describe('AC 7a / AC 8: messages', () => {
  const ru = (e: Parameters<typeof authErrorMessage>[0]) => translateMessage('ru', authErrorMessage(e));
  const en = (e: Parameters<typeof authErrorMessage>[0]) => translateMessage('en', authErrorMessage(e));
  it.each([
    [{ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, 'Incorrect email or password.', 'Неверный email или пароль.'],
    [{ status: 400, message: 'Invalid login credentials' }, 'Incorrect email or password.', 'Неверный email или пароль.'],
    [{ code: 'user_already_exists', status: 422, message: 'User already registered' }, 'An account with this email already exists.', 'Аккаунт с этим email уже существует.'],
    [{ code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' }, 'Confirm your email first: open the link we sent you.', 'Сначала подтвердите email: откройте ссылку из письма.'],
    [{ code: 'weak_password', status: 422, message: 'Password should be at least 6 characters.' }, 'The password is too weak. Use at least 6 characters.', 'Слишком простой пароль. Используйте не менее 6 символов.'],
    [{ code: 'weak_password', status: 422, message: 'Password should be at least 8 characters.' }, 'The password is too weak. Use at least 8 characters.', 'Слишком простой пароль. Используйте не менее 8 символов.'],
    [{ code: 'over_email_send_rate_limit', status: 429, message: 'x' }, 'Too many requests. Please wait a few minutes and try again.', 'Слишком много запросов. Подождите несколько минут и попробуйте снова.'],
    [{ status: 429, message: 'x' }, 'Too many requests. Please wait a few minutes and try again.', 'Слишком много запросов. Подождите несколько минут и попробуйте снова.'],
    [{ code: 'same_password', status: 422, message: 'x' }, 'The new password must be different from the current one', 'Новый пароль должен отличаться от текущего'],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' }, 'Could not reach the server. Check your connection and try again.', 'Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.'],
    [{ code: 'unexpected_failure', status: 500, message: 'Database error querying schema' }, 'Database error querying schema', 'Что-то пошло не так. Попробуйте снова.'],
    [null, 'Something went wrong. Please try again.', 'Что-то пошло не так. Попробуйте снова.'],
    [{ status: 500, message: '' }, 'Something went wrong. Please try again.', 'Что-то пошло не так. Попробуйте снова.'],
  ])('%j', (error, english, russian) => {
    expect(en(error)).toBe(english);
    expect(ru(error)).toBe(russian);
  });

  it('the app\'s own texts translate; a missing Russian text falls back to English; never a raw ID', () => {
    expect(translateMessage('ru', 'Current password is incorrect')).toBe('Текущий пароль неверен');
    expect(translateMessage('ru', 'Name must be 80 characters or fewer')).toBe('Имя должно быть не длиннее 80 символов');
    expect(translate('ru', 'no.such.id')).toBe('Что-то пошло не так. Попробуйте снова.');
    expect(translate('en', 'no.such.id')).toBe('Something went wrong. Please try again.');
  });
});

describe('the language shown (AC 2–6)', () => {
  function Probe() {
    const { lang, t } = useI18n();
    return <Text testID="probe">{`${lang}:${t('tabs.profile')}`}</Text>;
  }
  const shown = () => screen.getByTestId('probe').props.children;

  it('AC 2 / AC 6: signed out on a new device: the phone language', async () => {
    phone('ru-RU');
    setStore(fakeStore(null));
    await render(inApp(<Probe />));
    expect(shown()).toBe('ru:Профиль');
  });

  it('AC 4: the account choice wins over the phone, and is remembered on the device', async () => {
    phone('ru-RU');
    setStore(as('S1', 'en'));
    await render(inApp(<Probe />));
    expect(shown()).toBe('en:Profile');
    await flush();
    expect(await AsyncStorage.getItem(LAST_LANGUAGE_KEY)).toBe('en');
  });

  it('AC 5: never chose: the phone language', async () => {
    phone('ru-RU');
    setStore(as('S1'));
    await render(inApp(<Probe />));
    expect(shown()).toBe('ru:Профиль');
  });

  it('AC 6: after signing out, the sign-in screen keeps the language last shown on this device', async () => {
    setStore(as('S1', 'ru'));
    const view = await render(inApp(<Probe />));
    expect(shown()).toBe('ru:Профиль');
    await flush();
    expect(await AsyncStorage.getItem(LAST_LANGUAGE_KEY)).toBe('ru');
    await view.unmount();
    setStore(fakeStore(null));
    await render(inApp(<Probe />));
    await flush();
    expect(shown()).toBe('ru:Профиль');
  });

  it('edge: signed in, profile not loaded yet: the last language on the device, then the account\'s', async () => {
    await AsyncStorage.setItem(LAST_LANGUAGE_KEY, 'ru');
    setStore(fakeStore(null));
    const view = await render(inApp(<Probe />));
    await flush();
    expect(shown()).toBe('ru:Профиль');
    setStore(as('S1', 'en'));
    await view.rerender(inApp(<Probe />));
    expect(shown()).toBe('en:Profile');
  });
});

describe('AC 3 / AC 10: the Language switch on Profile', () => {
  it('shows English and Русский with the current one checked; picking one saves it', async () => {
    const store = as('S1', 'en');
    setStore(store);
    await render(inApp(<ProfileScreen />));
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'English', checked: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Русский' }));
    expect(store.setLanguage).toHaveBeenCalledWith('ru');
  });

  it('every text on Profile and the tab bar changes at once when the account language changes', async () => {
    setStore(as('M', 'en'));
    const view = await render(
      inApp(
        <>
          <TabLayout />
          <ProfileScreen />
        </>,
      ),
    );
    expect(screen.getAllByTestId('tab-title').map((t) => t.props.children)).toEqual(['To check', 'Courses', 'Materials', 'Profile']);
    expect(CYRILLIC.test(allText().replace(/Русский/g, ''))).toBe(false);
    setStore(as('M', 'ru'));
    await view.rerender(
      inApp(
        <>
          <TabLayout />
          <ProfileScreen />
        </>,
      ),
    );
    expect(screen.getAllByTestId('tab-title').map((t) => t.props.children)).toEqual(['Проверка', 'Курсы', 'Материалы', 'Профиль']);
    for (const text of ['Язык', 'Сменить пароль', 'Выйти', 'Удалить аккаунт', 'Ментор']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    // ARU-69: an icon button; its words are its accessibility label.
    expect(screen.getByRole('button', { name: /Открыть общий чат/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Русский', checked: true })).toBeTruthy();
  });

  it('while saving the switch is disabled (a double tap saves once); a failure keeps the language and shows red text', async () => {
    let fail: (e: Error) => void = () => {};
    const setLanguage = jest.fn(() => new Promise<void>((_, reject) => (fail = reject)));
    setStore(as('S1', 'en', { setLanguage }));
    await render(inApp(<ProfileScreen />));
    await fireEvent.press(screen.getByRole('radio', { name: 'Русский' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Русский' }));
    expect(setLanguage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'Русский' })).toBeDisabled();
    await act(async () => fail(new Error('offline')));
    expect(screen.getByText("Couldn't save your language. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'English', checked: true })).toBeTruthy();
  });

  it('the teacher gets it too, with Manage roles translated', async () => {
    setStore(as('T', 'ru', { accessRequests: [{ id: 'x', name: 'New', email: 'n@x', status: 'pending', createdAt: '2026-11-01T10:00:00Z' }] }));
    await render(inApp(<ProfileScreen />));
    expect(screen.getByText('Управление ролями (1)')).toBeTruthy();
    expect(screen.getByText('Язык')).toBeTruthy();
  });
});

describe('AC 7 / AC 12: the part-1 screens in Russian and English', () => {
  it('sign-in: Russian texts, no English; an Auth error in Russian', async () => {
    phone('ru-RU');
    const signIn = jest.fn(async () => {
      throw new Error('Incorrect email or password.');
    });
    setStore(fakeStore(null, { signIn }));
    await render(inApp(<SignInScreen />));
    for (const text of ['Домашние задания, проверки и занятия в одном месте.', 'Вход', 'Регистрация', 'Пароль', 'Забыли пароль?', 'Войти']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'a@b.c');
    await fireEvent.changeText(screen.getByPlaceholderText('Не менее 6 символов'), 'secret1');
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Неверный email или пароль.')).toBeTruthy();
    expect(/Sign in|Password|Forgot|Incorrect/.test(allText())).toBe(false);
  });

  it('sign-in: an unknown server error in Russian is the generic text; in English the server text', async () => {
    phone('ru-RU');
    const signUp = jest.fn(async () => {
      throw new Error('Signups not allowed for this instance');
    });
    setStore(fakeStore(null, { signUp }));
    const view = await render(inApp(<SignInScreen />));
    await fireEvent.press(screen.getByText('Регистрация'));
    await fireEvent.changeText(screen.getByPlaceholderText('Дана Серикова'), 'Аня');
    await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'a@b.c');
    await fireEvent.changeText(screen.getByPlaceholderText('Не менее 6 символов'), 'secret1');
    await fireEvent.press(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(await screen.findByText('Что-то пошло не так. Попробуйте снова.')).toBeTruthy();
    await view.unmount();
    phone('en-US');
    await render(inApp(<SignInScreen />));
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.changeText(screen.getByPlaceholderText('Dana Serikova'), 'Anya');
    await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'a@b.c');
    await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Create account' }).at(-1)!);
    expect(await screen.findByText('Signups not allowed for this instance')).toBeTruthy();
    expect(CYRILLIC.test(allText())).toBe(false);
  });

  it('the deleted-account notice is translated', async () => {
    phone('ru-RU');
    setStore(fakeStore(null, { accountNotice: 'Your account was deleted' }));
    await render(inApp(<SignInScreen />));
    expect(screen.getByText('Ваш аккаунт удалён')).toBeTruthy();
  });

  it('waiting and declined screens in Russian', async () => {
    const waiting = { ...users.S1, accessStatus: 'pending' as const, language: 'ru' as const };
    setStore(fakeStore('S1', { currentUser: waiting }));
    const view = await render(inApp(<AccessGate>{null}</AccessGate>));
    for (const text of ['Ожидает подтверждения', 'Проверить снова', 'Выйти', 'Удалить аккаунт']) expect(screen.getByText(text)).toBeTruthy();
    setStore(fakeStore('S1', { currentUser: { ...waiting, accessStatus: 'rejected' } }));
    await view.rerender(inApp(<AccessGate>{null}</AccessGate>));
    expect(screen.getByText('Заявка отклонена')).toBeTruthy();
    expect(screen.getByText('Учитель отклонил вашу заявку.')).toBeTruthy();
  });

  it('Reset password in Russian: the step texts and a wrong code', async () => {
    phone('ru-RU');
    const resetPasswordWithCode = jest.fn(async () => {
      throw new Error('This code is wrong or has expired. Check the email or send a new code.');
    });
    setStore(fakeStore(null, { resetPasswordWithCode }));
    await render(inApp(<ResetPasswordScreen />));
    expect(screen.getByText('Введите email, с которым вы регистрировались. Мы отправим код, чтобы задать новый пароль.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('reset-email'), 'a@b.c');
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить код' }));
    expect(await screen.findByText('Если для a@b.c есть аккаунт, мы отправили на него код. Это может занять несколько минут.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Отправить новый код \(\d+ с\)/ })).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('reset-code'), '123456');
    await fireEvent.changeText(screen.getByTestId('new-password'), 'secret1');
    await fireEvent.changeText(screen.getByTestId('confirm-password'), 'secret2');
    expect(screen.getByText('Пароли не совпадают')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('confirm-password'), 'secret1');
    await fireEvent.press(screen.getByRole('button', { name: 'Сбросить пароль' }));
    expect(await screen.findByText('Код неверный или устарел. Проверьте письмо или отправьте новый код.')).toBeTruthy();
  });

  it('Change password in Russian keeps its own wrong-password text', async () => {
    const changePassword = jest.fn(async () => {
      throw new Error('Current password is incorrect');
    });
    setStore(as('S1', 'ru', { changePassword }));
    await render(inApp(<ChangePasswordScreen />));
    expect(screen.getByText('Текущий пароль')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('current-password'), 'old123');
    await fireEvent.changeText(screen.getByTestId('new-password'), 'secret1');
    await fireEvent.changeText(screen.getByTestId('confirm-password'), 'secret1');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Текущий пароль неверен')).toBeTruthy();
  });

  it('AC 12: a user\'s name stays as typed in both languages', async () => {
    const named: User = { ...users.S1, name: 'Anya Иванова', language: 'ru' };
    setStore(fakeStore('S1', { currentUser: named }));
    const view = await render(inApp(<ProfileScreen />));
    expect(screen.getByText('Anya Иванова')).toBeTruthy();
    setStore(fakeStore('S1', { currentUser: { ...named, language: 'en' } }));
    await view.rerender(inApp(<ProfileScreen />));
    expect(screen.getByText('Anya Иванова')).toBeTruthy();
  });
});
