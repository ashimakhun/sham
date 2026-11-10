// ARU-109 (Russian version, part 2): the Homework, Courses, meetings and disciplines screens read from the catalog.
// In Russian no catalog English is left on screen (AC 1), user text stays as written (AC 8); plurals (AC 4), dates
// (AC 5), confirmations with their Cancel (AC 2) and app errors (AC 3) follow the language; English reads as before.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import ScheduleMeetingScreen from '@/app/courses/[id]/meetings/new';
import NewHomeworkScreen from '@/app/homework/new';
import { ErrorText } from '@/components/ui';
import { currentLanguage, formatNumberIn, translate, translateKnown } from '@/i18n';
import en from '@/i18n/en.json';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { confirmAction } from '@/lib/confirm';
import { personName } from '@/lib/deleteAccount';
import { ratingSummary, starsLabel } from '@/lib/feedback';
import { PHOTO_UNAVAILABLE } from '@/lib/photo';
import { formatDate, formatDateTime } from '@/lib/theme';
import type { CourseFeedback, Meeting, User } from '@/lib/types';
import { listenerTabLabel, withUnreadLabel } from '@/lib/unread';

import { courseA, fakeStore, hw, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en' }]) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/components/DateTimeField', () => ({ DateTimeField: () => null }));

const flush = () => act(async () => {});
const inApp = (ui: React.ReactElement) => <LanguageProvider>{ui}</LanguageProvider>;

/** Signed in as `who` with a language choice. */
const as = (who: keyof typeof users, language: 'en' | 'ru', over = {}) => {
  const me: User = { ...users[who], language };
  setStore(fakeStore(who, { currentUser: me, ...over }));
};

// The catalog's English texts that differ from the Russian (and are long enough not to be a name by chance).
const ru = require('@/i18n/ru.json') as Record<string, string>;
const ENGLISH = Object.entries(en as Record<string, string>)
  .filter(([id, text]) => ru[id] !== text && /[a-z]{3}/i.test(text))
  .map(([, text]) => text);
const pieces = (text: string) => text.split(/\{\w+\}/).map((p) => p.trim()).filter((p) => /[a-z]{3}/i.test(p) && p.length > 3);
const ENGLISH_PIECES = new Set(ENGLISH.flatMap(pieces));

/** Every text and screen-reader label rendered. */
function rendered(): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') return void out.push(node);
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: Record<string, unknown>; children?: unknown };
    for (const key of ['accessibilityLabel', 'accessibilityHint', 'placeholder', 'title']) {
      if (typeof n.props?.[key] === 'string') out.push(n.props[key] as string);
    }
    walk(n.children);
  };
  walk(screen.toJSON());
  return out;
}
/** AC 1: no English catalog text (or a fixed part of one) on a Russian screen. */
function expectNoCatalogEnglish() {
  // People's names ("Mentor Max") and course titles are user text (AC 8), not catalog English.
  const userText = (text: string) => Object.values(users).some((u) => text.includes(u.name)) || /^Homework h\d$/.test(text);
  const left = rendered()
    .filter((text) => !userText(text))
    .filter((text) => ENGLISH.includes(text) || [...ENGLISH_PIECES].some((p) => text.includes(p)));
  expect(left).toEqual([]);
}

const HOUR = 3600_000;
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: new Date(Date.now() + 24 * HOUR).toISOString(),
  topic: `Topic ${over.id}`,
  status: 'scheduled',
  createdById: 'M',
  createdAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete params[k as keyof typeof params];
});

describe('AC 1 / AC 8: screens in Russian, user text as written', () => {
  it('the Courses tab (mentor)', async () => {
    as('M', 'ru', { courseMembers: [member('A', 'S1')] });
    await render(inApp(<CoursesScreen />));
    await flush();
    expectNoCatalogEnglish();
    expect(screen.getAllByText('Algebra').length).toBeGreaterThan(0);
  });

  it('course details with meetings (owner)', async () => {
    params.id = 'A';
    as('M', 'ru', {
      courseMembers: [member('A', 'S1')],
      meetings: [meeting({ id: 'm1' }), meeting({ id: 'm2', status: 'canceled', startsAt: '2026-10-02T10:00:00.000Z' })],
    });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    expectNoCatalogEnglish();
    expect(screen.getByTestId('meeting-m1')).toBeTruthy();
    expect(screen.getByText('Equations and more')).toBeTruthy();
  });

  it('the Homework tab (student and mentor)', async () => {
    as('S1', 'ru', {
      courseMembers: [member('A', 'S1')],
      visibleHomework: [hw({ id: 'h1', courseId: 'A', title: 'Fractions' }), hw({ id: 'h2', courseId: 'A', status: 'checked', checkedById: 'M', checkedAt: '2026-10-11T10:00:00.000Z' })],
    });
    const view = await render(inApp(<HomeworkScreen />));
    await flush();
    expectNoCatalogEnglish();
    expect(screen.getByRole('tab', { name: 'Ждут проверки (1)' })).toBeTruthy();
    await view.unmount();

    as('M', 'ru', { courseMembers: [member('A', 'S1')], visibleHomework: [hw({ id: 'h1', courseId: 'A' })] });
    await render(inApp(<HomeworkScreen />));
    await flush();
    expectNoCatalogEnglish();
  });

  it('Add homework and Schedule meeting', async () => {
    as('S1', 'ru', { courseMembers: [member('A', 'S1')] });
    const view = await render(inApp(<NewHomeworkScreen />));
    await flush();
    expectNoCatalogEnglish();
    await view.unmount();

    params.id = 'A';
    as('M', 'ru');
    await render(inApp(<ScheduleMeetingScreen />));
    await flush();
    expectNoCatalogEnglish();
  });

  it('in English the same screen has no Russian', async () => {
    params.id = 'A';
    as('M', 'en', { courseMembers: [member('A', 'S1')], meetings: [meeting({ id: 'm1' })] });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    expect(rendered().filter((text) => /[а-яё]/i.test(text))).toEqual([]);
  });
});

describe('AC 4: plurals and numbers', () => {
  it.each([
    [1, 'Добавить 1 слушателя'],
    [2, 'Добавить 2 слушателя'],
    [5, 'Добавить 5 слушателей'],
    [11, 'Добавить 11 слушателей'],
    [21, 'Добавить 21 слушателя'],
  ])('add %i listeners (ru)', (count, text) => {
    expect(translate('ru', 'listeners.addCount', { count })).toBe(text);
  });

  it('English reads as before', () => {
    expect(translate('en', 'listeners.addCount', { count: 2 })).toBe('Add 2 listeners');
    expect(translate('en', 'listeners.addOne')).toBe('Add listener');
  });

  it.each([
    [1, 'Слушатель, 1 новое домашнее задание'],
    [3, 'Слушатель, 3 новых домашних задания'],
    [5, 'Слушатель, 5 новых домашних заданий'],
    [21, 'Слушатель, 21 новое домашнее задание'],
    [150, 'Слушатель, 99+ новых домашних заданий'],
  ])('listener tab label %i (ru)', (n, text) => {
    expect(listenerTabLabel(n, 'ru')).toBe(text);
  });

  it('unread and review counts in both languages', () => {
    expect(listenerTabLabel(3, 'en')).toBe('Listener, 3 new homework');
    expect(listenerTabLabel(0, 'ru')).toBe('Слушатель');
    expect(withUnreadLabel('Чат', 2, 'ru')).toBe('Чат, 2 новых сообщения');
    expect(withUnreadLabel('Chat', 1, 'en')).toBe('Chat, 1 new message');
    const fb = (rating: number) => ({ rating }) as CourseFeedback;
    expect(ratingSummary([fb(4), fb(5)], 'en')).toBe('★ 4.5 · 2 reviews');
    expect(ratingSummary([fb(4), fb(5)], 'ru')).toBe('★ 4,5 · 2 отзыва');
    expect(starsLabel(5, 'ru')).toBe('5 звёзд');
  });

  it('the notes limit: "10,000" / "10 000"', () => {
    expect(formatNumberIn('en', 10000)).toBe('10,000');
    expect(formatNumberIn('ru', 10000).replace(/\s/g, ' ')).toBe('10 000');
  });
});

describe('AC 5: dates follow the app language, not the phone', () => {
  it('theme dates use the current language', async () => {
    as('M', 'ru');
    await render(inApp(<CoursesScreen />));
    expect(currentLanguage()).toBe('ru');
    expect(formatDate('2026-05-12T10:00:00.000Z')).toBe('12 мая 2026');
    expect(formatDateTime('2026-05-12T10:00:00.000Z')).toMatch(/^12 мая 2026, \d\d:\d\d$/);
  });

  it('and English after switching back', async () => {
    as('M', 'en');
    await render(inApp(<CoursesScreen />));
    expect(formatDate('2026-05-12T10:00:00.000Z')).toBe('12 May 2026');
  });

  it('a bad date reads "Invalid Date" instead of throwing', () => {
    expect(formatDate('x')).toBe('Invalid Date');
  });
});

describe('AC 2 / AC 3: confirmations and app errors', () => {
  it('the shared confirmation\'s Cancel is in the app language', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const os = Platform.OS;
    Platform.OS = 'ios';
    as('M', 'ru');
    await render(inApp(<CoursesScreen />));
    void confirmAction('Удалить?', 'Текст', 'Удалить');
    expect(alert.mock.calls[0][2]?.[0].text).toBe('Отмена');
    Platform.OS = os;
  });

  it('known app messages are translated, database text is kept', async () => {
    expect(translateKnown('ru', 'The deadline must be in the future.')).toBe('Срок сдачи должен быть в будущем.');
    expect(translateKnown('ru', PHOTO_UNAVAILABLE)).toBe('Фото недоступно');
    expect(translateKnown('ru', 'A discipline name can be at most 100 characters.')).toBe('Название дисциплины — не более 100 символов.');
    expect(translateKnown('ru', 'new row violates row-level security policy')).toBe('new row violates row-level security policy');
    expect(translateKnown('en', 'Only a teacher or mentor can do this.')).toBe('Only a teacher or mentor can do this.');

    as('M', 'ru');
    await render(inApp(<ErrorText error="You cannot check your own homework." />));
    expect(screen.getByText('Нельзя проверять своё домашнее задание.')).toBeTruthy();
  });

  it('"Deleted account" follows the language', async () => {
    as('M', 'ru');
    await render(inApp(<CoursesScreen />));
    expect(personName(null, undefined, 'x')).toBe('Удалённый аккаунт');
  });
});

describe('AC 7: switching keeps the tab\'s state', () => {
  it('the Homework tab keeps the mentor\'s Listener choice after a language switch', async () => {
    const over = { courses: [{ ...courseA, createdById: 'M' }], courseMembers: [member('A', 'M2'), member('A', 'S1')] };
    as('M2', 'en', over);
    const view = await render(inApp(<HomeworkScreen />));
    await flush();
    await fireEvent.press(screen.getByRole('tab', { name: /^Listener/ }));
    as('M2', 'ru', over);
    await view.rerender(inApp(<HomeworkScreen />));
    await flush();
    expect(screen.getByRole('tab', { name: /^Слушатель/ }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText(/^Новые/)).toBeTruthy();
  });
});

describe('ARU-128: ARU-107 photo texts in both languages', () => {
  const { deletionWarningText, formatUtcDate } = require('@/lib/photoRetention');
  it.each([
    [1, '1 фото домашнего задания будет удалено 20 ноября 2026. Скачайте его сейчас.'],
    [3, '3 фото домашних заданий будут удалены 20 ноября 2026. Скачайте их сейчас.'],
  ])('%i photo(s) (ru)', (count, text) => {
    expect(deletionWarningText({ count, date: '2026-11-20' }, 'ru')).toBe(text);
  });
  it('English reads as before', () => {
    expect(deletionWarningText({ count: 1, date: '2026-11-20' }, 'en')).toBe(
      `1 homework photo will be deleted on ${formatUtcDate('2026-11-20', 'en')}. Download them now.`,
    );
    expect(translate('ru', 'homework.photoRule')).toMatch(/^Фото хранятся 6 месяцев/);
  });
});
