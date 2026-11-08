// ARU-113 (Russian version, part 3): Materials, chats, payments, accountant, Manage roles, the Telegram page and
// Delete account read from the catalog. In Russian no catalog English is left on screen (AC 1) except the two Telegram
// buttons (AC 11); user text stays as written (AC 8); plurals, sizes and dates follow the language (AC 4, AC 5);
// confirmations are in Russian (AC 2, AC 11) and app errors too (AC 3).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import RolesScreen from '@/app/roles';
import TelegramScreen from '@/app/telegram';
import { DeleteAccountForm } from '@/components/DeleteAccountForm';
import { formatDateIn, translate, translateKnown } from '@/i18n';
import en from '@/i18n/en.json';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { periodText, requestCountText } from '@/lib/billing';
import { ownedCoursesProblem } from '@/lib/deleteAccount';
import { formatSize, nameFromFile, PDF_RULE } from '@/lib/files';
import { PHOTO_PERMISSION } from '@/lib/paymentProof';
import { telegramSwitchesFor } from '@/lib/telegram';
import type { Material, TelegramLink, User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'ru-RU', languageCode: 'ru' }]) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const flush = () => act(async () => {});
const inApp = (ui: React.ReactElement) => <LanguageProvider>{ui}</LanguageProvider>;
const as = (who: keyof typeof users, language: 'en' | 'ru', over = {}) => {
  const me: User = { ...users[who], language };
  setStore(fakeStore(who, { currentUser: me, ...over }));
};

const ru = require('@/i18n/ru.json') as Record<string, string>;
const ENGLISH = Object.entries(en as Record<string, string>)
  .filter(([id, text]) => ru[id] !== text && /[a-z]{3}/i.test(text))
  .map(([, text]) => text);
const pieces = (text: string) => text.split(/\{\w+\}/).map((p) => p.trim()).filter((p) => /[a-z]{3}/i.test(p) && p.length > 3);
const ENGLISH_PIECES = [...new Set(ENGLISH.flatMap(pieces))];
/** AC 11: the only app English allowed on these screens. */
const ALLOWED = ['Connect Telegram', 'Disconnect'];

function rendered(): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') return void out.push(node);
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: Record<string, unknown>; children?: unknown };
    for (const key of ['accessibilityLabel', 'accessibilityHint', 'placeholder']) {
      if (typeof n.props?.[key] === 'string') out.push(n.props[key] as string);
    }
    walk(n.children);
  };
  walk(screen.toJSON());
  return out;
}
function expectNoCatalogEnglish(userText: string[] = []) {
  const mine = (text: string) =>
    ALLOWED.includes(text) || Object.values(users).some((u) => text.includes(u.name)) || userText.some((u) => text.includes(u));
  const left = rendered()
    .filter((text) => !mine(text))
    .filter((text) => ENGLISH.includes(text) || ENGLISH_PIECES.some((p) => text.includes(p)));
  expect(left).toEqual([]);
}

const post: Material = {
  id: 'p1',
  teacherId: 'M',
  title: 'How to study',
  body: 'Read **every** day',
  createdAt: '2026-10-20T10:00:00.000Z',
};
const linked: TelegramLink = {
  linkedAt: '2026-11-01T10:00:00.000Z',
  switches: { meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true },
};

beforeEach(async () => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
  await AsyncStorage.clear();
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

describe('AC 1 / AC 8: screens in Russian, user text as written', () => {
  it('the Materials tab (Blog)', async () => {
    as('S1', 'ru', { materials: [post] });
    await render(inApp(<MaterialsScreen />));
    await flush();
    expectNoCatalogEnglish(['How to study']);
    expect(screen.getByText('How to study')).toBeTruthy();
  });

  it('Manage roles (teacher)', async () => {
    as('T', 'ru');
    await render(inApp(<RolesScreen />));
    await flush();
    expectNoCatalogEnglish();
  });

  it('Delete account', async () => {
    as('S1', 'ru');
    await render(inApp(<DeleteAccountForm onCancel={() => {}} />));
    await flush();
    expectNoCatalogEnglish();
    expect(screen.getByText('Удалённый аккаунт')).toBeTruthy();
  });

  it('in English the Materials tab has no Russian', async () => {
    as('S1', 'en', { materials: [post] });
    await render(inApp(<MaterialsScreen />));
    await flush();
    expect(rendered().filter((text) => /[а-яё]/i.test(text))).toEqual([]);
  });
});

describe('AC 6 / AC 11: the Telegram page', () => {
  it('not connected: Russian page, the Connect button stays English', async () => {
    as('S1', 'ru', { telegram: null });
    await render(inApp(<TelegramScreen />));
    await flush();
    expectNoCatalogEnglish();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
  });

  it('connected: Russian switches and a Russian Disconnect confirmation, the button stays English', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const os = Platform.OS;
    Platform.OS = 'ios';
    as('S1', 'ru', { telegram: linked });
    await render(inApp(<TelegramScreen />));
    await flush();
    expectNoCatalogEnglish();
    expect(screen.getByText('Встреча началась')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Disconnect' }));
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Отключить Telegram');
    expect(message).toBe('Больше не получать уведомления Sham в Telegram?');
    expect(buttons?.map((b) => b.text)).toEqual(['Отмена', 'Отключить']);
    Platform.OS = os;
  });

  it.each(['T', 'M', 'S1'] as const)('%s: switch labels in Russian, the same switches as in English', (who) => {
    const role = users[who].role;
    const ruSwitches = telegramSwitchesFor(role, 'ru');
    const enSwitches = telegramSwitchesFor(role, 'en');
    expect(ruSwitches.map((s) => s.kind)).toEqual(enSwitches.map((s) => s.kind));
    for (const s of ruSwitches) expect(s.label).toMatch(/[а-яё]/i);
  });
});

describe('AC 4: plurals, sizes and limits', () => {
  it.each([
    [1, '1 лайк'],
    [2, '2 лайка'],
    [5, '5 лайков'],
    [11, '11 лайков'],
    [21, '21 лайк'],
  ])('%i likes (ru)', (count, text) => {
    expect(translate('ru', 'materials.likes', { count })).toBe(text);
  });

  it.each([
    [1, '1 запрос'],
    [2, '2 запроса'],
    [5, '5 запросов'],
    [11, '11 запросов'],
    [21, '21 запрос'],
  ])('%i payment requests (ru)', (count, text) => {
    expect(requestCountText(count, 'ru')).toBe(text);
  });

  it('English reads as before', () => {
    expect(translate('en', 'materials.likes', { count: 1 })).toBe('1 like');
    expect(translate('en', 'materials.likes', { count: 2 })).toBe('2 likes');
    expect(requestCountText(2, 'en')).toBe('2 requests');
  });

  it('file sizes in both languages', () => {
    expect(formatSize(1.2 * 1024 * 1024, 'en')).toBe('1.2 MB');
    expect(formatSize(1.2 * 1024 * 1024, 'ru')).toBe('1,2 МБ');
    expect(formatSize(500, 'ru')).toBe('500 Б');
    expect(formatSize(20 * 1024, 'en')).toBe('20 KB');
    expect(formatSize(undefined, 'ru')).toBe('—');
  });
});

describe('AC 5: dates and periods', () => {
  it('English dates on a Russian phone when the account chose English', async () => {
    as('S1', 'en');
    await render(inApp(<MaterialsScreen />));
    expect(formatDateIn('en', '2026-05-12T10:00:00.000Z')).toBe('12 May 2026');
    expect(periodText({ startDay: 1, endDay: 5 })).toBe('Pays 1–5 of each month');
  });

  it('Russian period text', () => {
    expect(periodText({ startDay: 1, endDay: 5 }, 'ru')).toBe('Оплата 1–5 числа каждого месяца');
  });
});

describe('AC 3: app errors', () => {
  it('rules and account messages are translated; database text is kept', () => {
    expect(translateKnown('ru', PDF_RULE)).toBe('Файл должен быть в формате PDF и не больше 25 МБ.');
    expect(translateKnown('ru', PHOTO_PERMISSION)).toMatch(/^Sham нужен доступ/);
    expect(translateKnown('ru', 'Payment days must be between 1 and 28.')).toBe('Дни оплаты должны быть от 1 до 28.');
    expect(translateKnown('ru', ownedCoursesProblem(['Biology', 'Algebra'])!)).toBe(
      'Вы владелец курсов: Algebra, Biology. Попросите преподавателя или ментора сначала сменить владельца.',
    );
    expect(translateKnown('ru', 'permission denied for table materials')).toBe('permission denied for table materials');
  });

  it('the Untitled fallback follows the language', async () => {
    as('M', 'ru');
    await render(inApp(<MaterialsScreen />));
    expect(nameFromFile(undefined)).toBe('Без названия');
  });
});
