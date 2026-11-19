// QA ARU-163: the refusal on the real screens (the dev test checks only dbErrorMessage). A course chat message, a
// general chat message, a new Blog post and a meeting note refused with sham:text_not_allowed show the message in the
// screen's usual error place, in English and Russian, and keep what was typed (AC 1–4, AC 10).
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import CourseChatScreen from '@/app/courses/[id]/chat';
import NotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import GeneralChatScreen from '@/app/general-chat';
import NewMaterialScreen from '@/app/materials/new';
import { dbErrorMessage } from '@/i18n';
import { I18nContext, make } from '@/i18n/context';
import type { Meeting } from '@/lib/types';
import { router } from 'expo-router';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const EN = "This text contains words that aren't allowed. Please change it.";
const RU = 'Текст содержит недопустимые слова. Измените его.';
const refusal = { message: EN, code: '23514', hint: 'sham:text_not_allowed', details: null };
// What the store throws: check() maps the database error to the app language's text.
const refused = (lang: 'en' | 'ru') => jest.fn(async () => Promise.reject(new Error(dbErrorMessage(refusal, lang))));
const inLang = (lang: 'en' | 'ru', ui: React.ReactElement) => <I18nContext.Provider value={make(lang)}>{ui}</I18nContext.Provider>;
const routeParams = params as Record<string, string | undefined>;

beforeEach(() => {
  jest.clearAllMocks();
  routeParams.id = 'A';
});

it.each([
  ['en', EN, 'Message'],
  ['ru', RU, 'Сообщение'],
] as const)('AC 1 / AC 10 (%s): a refused course chat message shows the error and stays in the input', async (lang, text, field) => {
  const sendMessage = refused(lang);
  setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], sendMessage }));
  await render(inLang(lang, <CourseChatScreen />));
  await act(async () => {});
  await fireEvent.changeText(screen.getByLabelText(field), 'hello zzbadword');
  await fireEvent.press(screen.getByTestId('chat-send'));
  await act(async () => {});
  expect(sendMessage).toHaveBeenCalled();
  expect(await screen.findByText(text)).toBeTruthy();
  expect(screen.getByLabelText(field).props.value).toBe('hello zzbadword');
});

it('AC 2: a refused general chat message shows the error and stays in the input', async () => {
  const sendGeneralMessage = refused('ru');
  setStore(fakeStore('S1', { sendGeneralMessage }));
  await render(inLang('ru', <GeneralChatScreen />));
  await act(async () => {});
  await fireEvent.changeText(screen.getByLabelText('Сообщение'), 'ззплохо');
  await fireEvent.press(screen.getByTestId('chat-send'));
  await act(async () => {});
  expect(sendGeneralMessage).toHaveBeenCalled();
  expect(await screen.findByText(RU)).toBeTruthy();
  expect(screen.getByLabelText('Сообщение').props.value).toBe('ззплохо');
});

it('AC 4: a refused Blog post shows the error and keeps the title and text', async () => {
  const addMaterial = refused('en');
  setStore(fakeStore('T', { addMaterial }));
  await render(<NewMaterialScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('e.g. Lesson 3: Decimals'), 'Title zzbadword');
  await fireEvent.changeText(screen.getByPlaceholderText('Explanation, instructions, what to read…'), 'Body text');
  await fireEvent.press(screen.getByRole('button', { name: 'Share with class' }));
  await act(async () => {});
  expect(addMaterial).toHaveBeenCalled();
  expect(await screen.findByText(EN)).toBeTruthy();
  expect(screen.getByPlaceholderText('e.g. Lesson 3: Decimals').props.value).toBe('Title zzbadword');
  expect(screen.getByDisplayValue('Body text')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
});

it('AC 3: a refused note stays in the editor with the error, and the editor doesn\'t close', async () => {
  routeParams.meetingId = 'C';
  routeParams.edit = '1';
  const meeting: Meeting = {
    id: 'C',
    courseId: 'A',
    startsAt: '2026-11-10T10:00:00.000Z',
    status: 'completed',
    createdById: 'M',
    createdAt: '2026-11-01T10:00:00.000Z',
  } as Meeting;
  const saveMyMeetingNotes = refused('ru');
  setStore(fakeStore('S1', { courses: [courseA], courseMembers: [member('A', 'S1')], meetings: [meeting], saveMyMeetingNotes }));
  await render(inLang('ru', <NotesScreen />));
  await act(async () => {});
  await fireEvent.changeText(screen.getByPlaceholderText(/.+/), 'мои ззплохо заметки');
  await fireEvent.press(screen.getAllByRole('button', { name: /Сохранить/ }).slice(-1)[0]);
  await act(async () => {});
  expect(saveMyMeetingNotes).toHaveBeenCalled();
  expect(await screen.findByText(RU)).toBeTruthy();
  expect(screen.getByDisplayValue('мои ззплохо заметки')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
  delete routeParams.edit;
  delete routeParams.meetingId;
});
