// ARU-121: on the Homework tab's New list, an overdue assignment keeps the thin red border (the ARU-95 / ARU-66 style)
// after its deadline day, until the homework is sent. Later days and "No deadline" keep the normal border.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import { needsAttention } from '@/components/AssignmentCard';
import { styles } from '@/components/ui';
import { colors } from '@/lib/theme';
import type { HomeworkAssignment, Meeting } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

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
const asg = (id: string, dueAt?: string, meetingId = 'C1'): HomeworkAssignment => ({
  id,
  meetingId,
  courseId: 'A',
  title: `Assignment ${id}`,
  description: '',
  createdById: 'M',
  createdAt: local(9, 1, 12),
  dueAt,
});

const reported = asg('reported', local(10, 5, 9)); // the product owner's case: due 5 Nov 09:00
const yesterday = asg('yesterday', local(10, 7, 9));
const weeksAgo = asg('weeksAgo', local(9, 15, 9)); // three weeks late
const todayAhead = asg('todayAhead', local(10, 8, 23, 59));
const todayPassed = asg('todayPassed', local(10, 8, 0, 1));
const tomorrow = asg('tomorrow', local(10, 9, 0, 1));
const nextWeek = asg('nextWeek', local(10, 15, 9));
const none = asg('none');
const all = [reported, yesterday, weeksAgo, todayAhead, todayPassed, tomorrow, nextWeek, none];

const cardStyle = (id: string) =>
  StyleSheet.flatten(screen.getByText(`Assignment ${id}`).parent!.parent!.props.style);
const isRed = (id: string) => {
  const s = cardStyle(id);
  return s.borderWidth === 1 && s.borderColor === colors.danger;
};
const hasBadge = (id: string) => within(screen.getByText(`Assignment ${id}`).parent!).queryByText('Overdue') !== null;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

describe('needsAttention', () => {
  it.each([
    [reported, true],
    [yesterday, true],
    [weeksAgo, true],
    [todayAhead, true],
    [todayPassed, true],
    [tomorrow, false],
    [nextWeek, false],
    [none, false],
  ])('%s → %s', (a, expected) => {
    expect(needsAttention(a, NOW)).toBe(expected);
  });
});

describe.each(['S1', 'M2'] as const)('New list for %s', (who) => {
  const open = async (assignments = all) => {
    setStore(
      fakeStore(who, {
        courseMembers: [member('A', 'S1'), member('A', 'M2')],
        meetings: [meeting('C1')],
        assignments,
      }),
    );
    await render(<HomeworkScreen />);
    if (who === 'M2') await fireEvent.press(screen.getByText(/^Listener/));
  };

  it('AC1: overdue cards from earlier days (even weeks late) keep the red border and the Overdue badge', async () => {
    await open();
    for (const id of ['reported', 'yesterday', 'weeksAgo']) {
      expect(isRed(id)).toBe(true);
      expect(hasBadge(id)).toBe(true);
      expect(screen.getByTestId(`assignment-overdue-${id}`)).toBeTruthy();
      expect(screen.queryByTestId(`assignment-due-today-${id}`)).toBeNull();
    }
  });

  it('AC2: due today has the same border before and after its time; only the badge differs', async () => {
    await open();
    expect(cardStyle('todayAhead')).toEqual(cardStyle('todayPassed'));
    expect(cardStyle('todayAhead')).toEqual(cardStyle('reported'));
    expect(hasBadge('todayAhead')).toBe(false);
    expect(hasBadge('todayPassed')).toBe(true);
    expect(screen.getByTestId('assignment-due-today-todayAhead')).toBeTruthy();
    expect(screen.getByTestId('assignment-due-today-todayPassed')).toBeTruthy();
  });

  it('AC3/AC4: later days and no deadline keep the normal border', async () => {
    await open();
    for (const id of ['tomorrow', 'nextWeek', 'none']) {
      expect(isRed(id)).toBe(false);
      expect(hasBadge(id)).toBe(false);
      expect(screen.queryByTestId(new RegExp(`^assignment-(due-today|overdue)-${id}$`))).toBeNull();
    }
    expect(screen.getByText('No deadline')).toBeTruthy();
  });

  it('AC6: past midnight, yesterday and today keep the border and tomorrow gets it', async () => {
    await open();
    await act(async () => {
      jest.setSystemTime(new Date(2026, 10, 9, 0, 0, 10));
      jest.advanceTimersByTime(30_000);
    });
    for (const id of ['yesterday', 'todayAhead', 'todayPassed', 'tomorrow']) expect(isRed(id)).toBe(true);
    expect(screen.getByTestId('assignment-overdue-todayAhead')).toBeTruthy();
    expect(screen.getByTestId('assignment-due-today-tomorrow')).toBeTruthy();
    expect(isRed('nextWeek')).toBe(false);
  });
});

it('AC7: the bordered overdue card keeps the card layout; only the border width and colour change', async () => {
  setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], meetings: [meeting('C1')], assignments: [reported] }));
  await render(<HomeworkScreen />);
  const s = StyleSheet.flatten(screen.getByTestId('assignment-overdue-reported').props.style);
  expect(s).toEqual({ ...StyleSheet.flatten(styles.card), borderWidth: 1, borderColor: colors.danger });
  expect(screen.getByText(/^Due /)).toBeTruthy();
});

it('AC5/AC7: homework sent for an overdue assignment leaves New and has no red border in Waiting or Checked', async () => {
  setStore(
    fakeStore('S1', {
      courseMembers: [member('A', 'S1')],
      meetings: [meeting('C1'), meeting('C2'), meeting('C3')],
      assignments: [asg('open', local(10, 5, 9), 'C1'), asg('sent', local(10, 5, 9), 'C2'), asg('done', local(10, 5, 9), 'C3')],
      visibleHomework: [
        hw({ id: 'h-sent', courseId: 'A', studentId: 'S1', title: 'Sent work', assignmentId: 'sent', status: 'submitted' }),
        hw({ id: 'h-done', courseId: 'A', studentId: 'S1', title: 'Checked work', assignmentId: 'done', status: 'checked' }),
      ],
    }),
  );
  await render(<HomeworkScreen />);
  expect(screen.getByTestId('assignment-overdue-open')).toBeTruthy();
  expect(screen.queryByText('Assignment sent')).toBeNull();
  expect(screen.queryByText('Assignment done')).toBeNull();
  await fireEvent.press(screen.getByRole('tab', { name: /^Waiting/ }));
  expect(screen.getByText('Sent work')).toBeTruthy();
  expect(screen.queryByTestId(/^assignment-(due-today|overdue)-/)).toBeNull();
  await fireEvent.press(screen.getByRole('tab', { name: /^Checked/ }));
  expect(screen.getByText('Checked work')).toBeTruthy();
  expect(screen.queryByTestId(/^assignment-(due-today|overdue)-/)).toBeNull();
});

it("AC7: the mentor's Owner tab shows no red border", async () => {
  setStore(
    fakeStore('M', {
      courseMembers: [member('A', 'S1')],
      meetings: [meeting('C1')],
      assignments: all,
      visibleHomework: [hw({ id: 'h1', courseId: 'A', studentId: 'S1', title: 'Sent hw' })],
    }),
  );
  await render(<HomeworkScreen />);
  expect(screen.queryByTestId(/^assignment-(due-today|overdue)-/)).toBeNull();
});
