// ARU-95: on the Homework tab's New list, an assignment due on today's local date gets a thin red border
// (the ARU-66 "Payment due" style). Earlier days, later days and "No deadline" keep the normal border.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import { isDueToday } from '@/components/AssignmentCard';
import { colors } from '@/lib/theme';
import type { HomeworkAssignment, Meeting } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

// Wednesday 4 Nov 2026, 15:00 local time.
const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

const meeting: Meeting = {
  id: 'C1',
  courseId: 'A',
  startsAt: local(1, 10),
  topic: 'Topic',
  status: 'completed',
  createdById: 'M',
  createdAt: local(1, 9),
};
const asg = (id: string, dueAt?: string): HomeworkAssignment => ({
  id,
  meetingId: 'C1',
  courseId: 'A',
  title: `Assignment ${id}`,
  description: '',
  createdById: 'M',
  createdAt: local(1, 12),
  dueAt,
});

const later = asg('later', local(4, 20)); // today, still ahead
const passed = asg('passed', local(4, 9)); // today, time passed
const midnight = asg('midnight', local(4, 0)); // today 00:00
const lastMinute = asg('lastMinute', local(4, 23, 59)); // today 23:59
const yesterday = asg('yesterday', local(3, 23, 59));
const tomorrow = asg('tomorrow', local(5, 0));
const none = asg('none');
const all = [later, passed, midnight, lastMinute, yesterday, tomorrow, none];

const border = (id: string) => StyleSheet.flatten(screen.getByText(`Assignment ${id}`).parent!.parent!.props.style);
const isRed = (id: string) => {
  const s = border(id);
  return s.borderWidth === 1 && s.borderColor === colors.danger;
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

describe('isDueToday', () => {
  it.each([
    [later, true],
    [passed, true],
    [midnight, true],
    [lastMinute, true],
    [yesterday, false],
    [tomorrow, false],
    [none, false],
  ])('%s → %s', (a, expected) => {
    expect(isDueToday(a, NOW)).toBe(expected);
  });
});

describe.each(['S1', 'M2'] as const)('New list for %s', (who) => {
  const open = async () => {
    setStore(
      fakeStore(who, {
        courseMembers: [member('A', 'S1'), member('A', 'M2')],
        meetings: [meeting],
        assignments: all,
      }),
    );
    await render(<HomeworkScreen />);
    if (who === 'M2') await fireEvent.press(screen.getByText(/^Listener/));
  };

  it('AC1/AC2: due-today cards get the red border and keep Due text; overdue today keeps the badge', async () => {
    await open();
    for (const id of ['later', 'passed', 'midnight', 'lastMinute']) {
      expect(isRed(id)).toBe(true);
      expect(screen.getByTestId(`assignment-due-today-${id}`)).toBeTruthy();
    }
    expect(screen.getAllByText('Overdue').length).toBe(3); // passed, midnight, yesterday
  });

  it('AC3/AC4/AC5: tomorrow, yesterday and no deadline keep the normal border', async () => {
    await open();
    for (const id of ['tomorrow', 'yesterday', 'none']) {
      expect(isRed(id)).toBe(false);
      expect(screen.queryByTestId(`assignment-due-today-${id}`)).toBeNull();
    }
  });

  it('AC6: after midnight the border moves to the new day on the next tick', async () => {
    await open();
    expect(isRed('tomorrow')).toBe(false);
    await act(async () => {
      jest.setSystemTime(new Date(2026, 10, 5, 0, 0, 10));
      jest.advanceTimersByTime(30_000);
    });
    expect(isRed('tomorrow')).toBe(true);
    expect(isRed('later')).toBe(false);
  });
});

it('AC7: the mentor Owner tab shows no red border', async () => {
  setStore(
    fakeStore('M', {
      courseMembers: [member('A', 'S1')],
      meetings: [meeting],
      assignments: all,
      visibleHomework: [hw({ id: 'h1', courseId: 'A', studentId: 'S1', title: 'Sent hw' })],
    }),
  );
  await render(<HomeworkScreen />);
  expect(screen.queryByTestId(/^assignment-due-today-/)).toBeNull();
});
