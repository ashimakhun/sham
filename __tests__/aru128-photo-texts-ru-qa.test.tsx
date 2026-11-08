// QA ARU-128: ARU-107's texts taken over by ARU-109's catalog. In Russian, the photo deletion banner on the Homework
// tab, Download my photos with its Preparing… state and error, Download by course and the rule under Photo on Add
// homework show no English; in English they stay ARU-107's words.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import NewHomeworkScreen from '@/app/homework/new';
import DownloadByCourseScreen from '@/app/homework/photos';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import type { Homework, HomeworkAssignment, User } from '@/lib/types';

import { courseA, courseB, fakeStore, hw, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en' }]) }));

const NOW = new Date('2026-11-08T10:00:00Z');
const photo = (id: string, over: Partial<Homework> = {}): Homework =>
  hw({ id, courseId: 'A', photoPath: `S1/${id}.jpg`, photoUrl: `https://signed/${id}`, ...over });
const due = (id: string) => photo(id, { status: 'checked', checkedAt: '2026-05-20T10:00:00Z' });
const flush = () => act(async () => {});
const inApp = (ui: React.ReactElement) => <LanguageProvider>{ui}</LanguageProvider>;

const as = (language: 'en' | 'ru', over = {}) => {
  const me: User = { ...users.S1, language };
  const store = fakeStore('S1', {
    currentUser: me,
    courses: [courseA, courseB],
    courseMembers: [member('A', 'S1'), member('B', 'S1')],
    photoDeletionStart: '2026-11-01',
    ...over,
  });
  setStore(store);
  return store;
};

/** ARU-107's English words; none may show in Russian. */
const ENGLISH = /Download|Preparing|homework photo|will be deleted|Photos are kept|No photos|Part \d|Couldn't prepare/;
/** Every rendered string, with labels, hints and titles. */
function texts() {
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  for (const k of Object.keys(params)) delete params[k as keyof typeof params];
});
afterEach(() => jest.restoreAllMocks());

it('Russian: the banner is a Russian plural with a Russian date and a Russian button', async () => {
  as('ru', { visibleHomework: [due('h1'), due('h2'), due('h3')] });
  await render(inApp(<HomeworkScreen />));
  await flush();
  const banner = screen.getByTestId('photo-deletion-banner');
  expect(banner).toBeTruthy();
  expect(screen.getByText(/^3 фото домашних заданий будут удалены 20 ноября 2026/)).toBeTruthy();
  expect(screen.getAllByText('Скачать фото').length).toBeGreaterThan(0);
  expect(texts().filter((t) => ENGLISH.test(t))).toEqual([]);
});

it('Russian: one photo uses the singular form', async () => {
  as('ru', { visibleHomework: [due('h1')] });
  await render(inApp(<HomeworkScreen />));
  await flush();
  expect(screen.getByText(/^1 фото домашнего задания будет удалено/)).toBeTruthy();
});

it('Russian: Download my photos on Checked, its Preparing… state and its error are Russian', async () => {
  let fail!: (e: Error) => void;
  const requestPhotoZip = jest.fn(() => new Promise<string>((_, reject) => (fail = reject)));
  as('ru', { visibleHomework: [photo('later', { status: 'checked', checkedAt: '2026-10-20T10:00:00Z' })], requestPhotoZip });
  await render(inApp(<HomeworkScreen />));
  await flush();
  await fireEvent.press(screen.getByText('Проверено'));
  const btn = screen.getByRole('button', { name: 'Скачать мои фото' });
  fireEvent.press(btn);
  await waitFor(() => expect(screen.getByText('Подготовка…')).toBeTruthy());
  await act(async () => fail(new Error("Couldn't prepare your photos. Check your connection and try again.")));
  expect(await screen.findByText('Не удалось подготовить фото. Проверьте подключение и попробуйте ещё раз.')).toBeTruthy();
  expect(texts().filter((t) => ENGLISH.test(t))).toEqual([]);
});

it('Russian: Download by course shows Russian parts, counts, labels and empty state', async () => {
  const list = [...Array.from({ length: 51 }, (_, i) => photo(`a${i}`)), photo('b1', { courseId: 'B' })];
  as('ru', { visibleHomework: list });
  const view = await render(inApp(<DownloadByCourseScreen />));
  await flush();
  expect(screen.getByRole('button', { name: /^Скачать: Algebra · Часть 1 из 2 · 50 фото$/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Скачать: Biology · 1 фото$/ })).toBeTruthy();
  expect(texts().filter((t) => ENGLISH.test(t))).toEqual([]);
  await view.unmount();
  as('ru', { visibleHomework: [] });
  await render(inApp(<DownloadByCourseScreen />));
  await flush();
  expect(screen.getByText('Нет фото для скачивания')).toBeTruthy();
});

it('Russian: Add homework shows the rule under Photo in Russian', async () => {
  const assignment: HomeworkAssignment = {
    id: 'a1',
    courseId: 'A',
    meetingId: 'C1',
    title: 'Fractions',
    description: '',
    createdById: 'M',
    createdAt: '2026-10-20T10:00:00.000Z',
  };
  params.assignmentId = 'a1';
  as('ru', { assignments: [assignment] });
  await render(inApp(<NewHomeworkScreen />));
  await flush();
  expect(screen.getByText('Фото хранятся 6 месяцев после проверки домашнего задания, затем удаляются.')).toBeTruthy();
  expect(texts().filter((t) => ENGLISH.test(t))).toEqual([]);
});

it('English: the same texts stay ARU-107\'s words, with no Cyrillic', async () => {
  as('en', { visibleHomework: [due('h1')] });
  await render(inApp(<HomeworkScreen />));
  await flush();
  expect(screen.getByText(/^1 homework photo will be deleted on 20 Nov(ember)? 2026\. Download them now\.$/)).toBeTruthy();
  expect(texts().filter((t) => /[А-Яа-яЁё]/.test(t))).toEqual([]);
});
