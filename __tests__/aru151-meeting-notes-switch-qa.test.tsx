// QA ARU-151 AC 7: gaps in the dev tests for the Meeting notes switch on the Telegram notifications page: every role
// sees it right below New materials (teacher: before New accounts), in Russian «Заметки к встречам», on for a link
// saved before the column existed (no meeting_notes key), and turning it off saves kind 'meeting_notes' only.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import TelegramScreen from '@/app/telegram';
import { I18nContext, make } from '@/i18n/context';
import type { TelegramLink } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

// A link read from an older database row: no meeting_notes key at all.
const linked: TelegramLink = {
  linkedAt: '2026-11-01T10:00:00.000Z',
  switches: { meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true },
};
const switches = () => screen.queryAllByRole('switch').map((s) => s.props.accessibilityLabel as string);
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

it.each([
  ['S1', 'student'],
  ['M', 'mentor'],
  ['T', 'teacher'],
] as const)('AC 7: %s (%s) sees Meeting notes right below New materials, on by default', async (who, role) => {
  setStore(fakeStore(who, { telegram: linked }));
  await render(<TelegramScreen />);
  const names = switches();
  const i = names.indexOf('Meeting notes');
  expect(i).toBeGreaterThan(0);
  expect(names[i - 1]).toBe('New materials');
  if (role === 'teacher') expect(names[i + 1]).toBe('New accounts');
  else expect(names).not.toContain('New accounts');
  expect(names.filter((n) => n === 'Meeting notes')).toHaveLength(1);
  const sw = screen.getByRole('switch', { name: 'Meeting notes' });
  expect(sw.props.value).toBe(true);
});

it('AC 7: in Russian the switch reads «Заметки к встречам», right below «Новые материалы»', async () => {
  setStore(fakeStore('S1', { telegram: linked }));
  await render(ru(<TelegramScreen />));
  const names = switches();
  const i = names.indexOf('Заметки к встречам');
  expect(i).toBeGreaterThan(0);
  expect(names[i - 1]).toBe('Новые материалы');
  expect(names).not.toContain('Meeting notes');
});

it('AC 7: turning it off saves only kind meeting_notes', async () => {
  const store = fakeStore('M', { telegram: linked });
  setStore(store);
  await render(<TelegramScreen />);
  await act(async () => {
    fireEvent(screen.getByRole('switch', { name: 'Meeting notes' }), 'valueChange', false);
  });
  expect(store.setTelegramNotification).toHaveBeenCalledTimes(1);
  expect(store.setTelegramNotification).toHaveBeenCalledWith('meeting_notes', false);
});

it('AC 7: a link saved with Meeting notes off shows it off, and the others stay as saved', async () => {
  setStore(fakeStore('S1', { telegram: { ...linked, switches: { ...linked.switches, meeting_notes: false } } }));
  await render(<TelegramScreen />);
  expect(screen.getByRole('switch', { name: 'Meeting notes' }).props.value).toBe(false);
  expect(screen.getByRole('switch', { name: 'New materials' }).props.value).toBe(true);
});
