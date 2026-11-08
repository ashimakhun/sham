// QA ARU-121: gaps in aru121-overdue-border.test.tsx: a deadline at exactly "now" and one at local midnight today;
// a card whose deadline passes while the tab is open gains the "overdue" testID only on the next day (the border
// stays the same); in Russian the overdue card keeps the border with the
// translated "Просрочено" badge; homework sent late for an overdue assignment shows no red border in Waiting.
// Several overdue cards are all bordered.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { colors } from '@/lib/theme';
import type { HomeworkAssignment, Meeting, User } from '@/lib/types';

import { fakeStore, hw, member, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en' }]) }));

// Sunday 8 Nov 2026, 15:00 local time.
const NOW = new Date(2026, 10, 8, 15, 0).getTime();
const local = (month: number, d: number, h: number, m = 0) => new Date(2026, month, d, h, m).toISOString();
const meeting = (id: string): Meeting => ({
  id,
  courseId: 'A',
  startsAt: local(9, 1, 10),
  topic: 'Topic',
  status: 'completed',
  createdById: 'M',
  createdAt: local(9, 1, 9),
});
const asg = (id: string, dueAt: string | undefined, meetingId: string, createdAt = local(9, 1, 12)): HomeworkAssignment => ({
  id,
  meetingId,
  courseId: 'A',
  title: `Assignment ${id}`,
  description: '',
  createdById: 'M',
  createdAt,
  dueAt,
});
const isRed = (id: string) => {
  const s = StyleSheet.flatten(screen.getByText(`Assignment ${id}`).parent!.parent!.props.style);
  return s.borderWidth === 1 && s.borderColor === colors.danger;
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

const open = async (assignments: HomeworkAssignment[], over: Parameters<typeof fakeStore>[1] = {}, me?: User) => {
  const meetings = assignments.map((a) => meeting(a.meetingId));
  const s = fakeStore('S1', { courseMembers: [member('A', 'S1')], meetings, assignments, ...over });
  setStore(me ? { ...s, currentUser: me } : s);
  await render(
    <LanguageProvider>
      <HomeworkScreen />
    </LanguageProvider>,
  );
  await act(async () => {});
};

it('AC1 / AC2: a deadline at exactly now, and one at 00:00 today, are both bordered as due today', async () => {
  await open([asg('exact', new Date(NOW).toISOString(), 'C1'), asg('midnight', local(10, 8, 0, 0), 'C2')]);
  expect(isRed('exact')).toBe(true);
  expect(isRed('midnight')).toBe(true);
  expect(screen.getByTestId('assignment-due-today-exact')).toBeTruthy();
  expect(screen.getByTestId('assignment-due-today-midnight')).toBeTruthy();
});

it('AC2 / AC6: a deadline passing while open keeps the same border; next day it is "overdue"', async () => {
  await open([asg('later', local(10, 8, 15, 10), 'C1')]);
  expect(isRed('later')).toBe(true);
  expect(screen.queryByText('Overdue')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(15 * 60_000); // 15:15, the deadline time has passed
  });
  expect(isRed('later')).toBe(true);
  expect(screen.getByText('Overdue')).toBeTruthy();
  expect(screen.getByTestId('assignment-due-today-later')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(9 * 3600_000); // 00:15 on 9 Nov
  });
  expect(isRed('later')).toBe(true);
  expect(screen.getByTestId('assignment-overdue-later')).toBeTruthy();
});

it('edge case: several overdue cards are all bordered', async () => {
  const a = [
    asg('o1', local(10, 1, 9), 'C1', local(9, 1, 12)),
    asg('o2', local(9, 20, 9), 'C2', local(9, 2, 12)),
    asg('o3', local(10, 6, 9), 'C3', local(9, 3, 12)),
  ];
  await open(a);
  expect(screen.getAllByText(/^Assignment o\d$/)).toHaveLength(3);
  for (const x of ['o1', 'o2', 'o3']) {
    expect(isRed(x)).toBe(true);
    expect(screen.getByTestId(`assignment-overdue-${x}`)).toBeTruthy();
  }
});

it('Russian: the overdue card keeps the red border with the translated badge', async () => {
  await open([asg('ru', local(10, 5, 9), 'C1')], {}, { ...users.S1, language: 'ru' });
  expect(isRed('ru')).toBe(true);
  expect(screen.getByText('Просрочено')).toBeTruthy();
  expect(screen.queryByText('Overdue')).toBeNull();
});

it('AC5: homework sent late for an overdue assignment has no red border in Waiting', async () => {
  const late = asg('late', local(10, 2, 9), 'C1');
  await open([late], {
    visibleHomework: [
      hw({ id: 'h-late', courseId: 'A', studentId: 'S1', title: 'Late work', assignmentId: 'late', status: 'submitted' }),
    ],
  });
  expect(screen.queryByText('Assignment late')).toBeNull();
  await fireEvent.press(screen.getByRole('tab', { name: /^Waiting/ }));
  expect(screen.getByText('Late work')).toBeTruthy();
  expect(screen.queryByTestId(/^assignment-(due-today|overdue)-/)).toBeNull();
});
