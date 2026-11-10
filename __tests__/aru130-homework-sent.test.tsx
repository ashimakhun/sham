// ARU-130: "Homework sent: 5 of 8" on completed meeting tiles with homework: under Due on Awaiting homework check,
// under the title in MEETING HISTORY, for everyone who sees the meetings; hidden when the count didn't load; plain
// text read as "Homework sent by 5 of 8 listeners".
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { translate } from '@/i18n';
import { colors } from '@/lib/theme';
import type { AssignmentSentCount, HomeworkAssignment, Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24),
  topic: 'Meeting',
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-100),
  ...over,
});
// Awaiting check, history (checked), history without homework, scheduled, in progress, canceled.
const C = meeting({ id: 'C', startsAt: at(-20), status: 'completed' });
const K = meeting({ id: 'K', startsAt: at(-40), status: 'completed', homeworkCheckedAt: at(-30), homeworkCheckedById: 'M' });
const KN = meeting({ id: 'KN', startsAt: at(-60), status: 'completed', homeworkCheckedAt: at(-50), homeworkCheckedById: 'M' });
const F = meeting({ id: 'F', startsAt: at(5) });
const P = meeting({ id: 'P', startsAt: at(-1) });
const X = meeting({ id: 'X', startsAt: at(-10), status: 'canceled' });
const asg = (meetingId: string): HomeworkAssignment => ({
  id: `a-${meetingId}`,
  meetingId,
  courseId: 'A',
  title: 'Essay',
  description: '',
  createdById: 'M',
  createdAt: at(-19),
  dueAt: at(48),
});
// Assignments on every meeting, even ones that can't have one in the app, to show the status decides.
const assignments = [asg('C'), asg('K'), asg('F'), asg('P'), asg('X')];
const counts: Record<string, AssignmentSentCount> = {
  'a-C': { sent: 5, listeners: 8 },
  'a-K': { sent: 0, listeners: 8 },
  'a-F': { sent: 1, listeners: 8 },
  'a-P': { sent: 1, listeners: 8 },
  'a-X': { sent: 1, listeners: 8 },
};
const members = [member('A', 'S1')];
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const order = (tile: ReturnType<typeof screen.getByTestId>) => {
  const ids: string[] = [];
  const walk = (n: unknown) => {
    const node = n as { props?: { testID?: string }; children?: unknown[] };
    if (typeof n === 'string' || !node) return;
    if (node.props?.testID) ids.push(node.props.testID);
    node.children?.forEach(walk);
  };
  walk(tile);
  return ids;
};

const show = async (who: string, over: Record<string, unknown> = {}) => {
  setStore(
    fakeStore(who, {
      courseMembers: members,
      meetings: [C, K, KN, F, P, X],
      assignments,
      assignmentSentCounts: counts,
      ...over,
    }),
  );
  await render(<CourseDetailScreen />);
};

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('AC 1: where the line shows', () => {
  it('awaiting check: the grey document icon and "Homework sent: 5 of 8", under the Due line', async () => {
    await show('S1');
    const line = screen.getByTestId('homework-sent-C');
    expect(within(line).getByTestId('icon-document-text-outline').props.color).toBe(colors.muted);
    expect(within(line).getByText(/^Homework sent:/)).toBeTruthy();
    const numbers = within(line).getByText('5 of 8');
    expect(StyleSheet.flatten(numbers.props.style).color).toBe(colors.text);
    const ids = order(screen.getByTestId('meeting-C'));
    expect(ids.indexOf('homework-sent-C')).toBeGreaterThan(ids.indexOf('assignment-due-C'));
  });

  it('history: under the title (before the actions), and 0 of 8 still shows', async () => {
    await show('M');
    const line = screen.getByTestId('homework-sent-K');
    expect(within(line).getByText('0 of 8')).toBeTruthy();
    const ids = order(screen.getByTestId('meeting-K'));
    expect(ids.indexOf('homework-sent-K')).toBeLessThan(ids.indexOf('actions-K') === -1 ? Infinity : ids.indexOf('actions-K'));
  });

  it('not on scheduled, in-progress or canceled meetings, or on a completed meeting without homework', async () => {
    await show('M');
    for (const id of ['F', 'P', 'X', 'KN']) expect(inMeeting(id).queryByText(/Homework sent/)).toBeNull();
  });
});

describe('AC 3: who sees it', () => {
  it.each([
    ['a student listener', 'S1'],
    ['the owner', 'M'],
    ['another mentor', 'N'],
    ['the teacher', 'T'],
  ])('%s sees the same numbers', async (_who, id) => {
    await show(id);
    expect(within(screen.getByTestId('homework-sent-C')).getByText('5 of 8')).toBeTruthy();
  });
});

describe('AC 6: no count, no line', () => {
  it('an assignment without a loaded count shows no line (never a wrong number), and the tile still shows', async () => {
    await show('M', { assignmentSentCounts: {} });
    expect(screen.queryByText(/Homework sent/)).toBeNull();
    expect(screen.getByTestId('assignment-due-C')).toBeTruthy();
  });
});

describe('AC 7: plain text with its own screen reader text', () => {
  it('one accessible element read as "Homework sent by 5 of 8 listeners", with no button or link role', async () => {
    await show('S1');
    const line = screen.getByTestId('homework-sent-C');
    expect(line.props.accessible).toBe(true);
    expect(line.props.accessibilityLabel).toBe('Homework sent by 5 of 8 listeners');
    expect(line.props.accessibilityRole).toBeUndefined();
    expect(line.props.onPress).toBeUndefined();
    fireEvent.press(line);
    expect(screen.getByTestId('homework-sent-C')).toBeTruthy();
  });

  it('1 listener reads in the singular', async () => {
    await show('S1', { assignmentSentCounts: { 'a-C': { sent: 1, listeners: 1 } } });
    expect(screen.getByTestId('homework-sent-C').props.accessibilityLabel).toBe('Homework sent by 1 of 1 listener');
  });
});

describe('Russian texts', () => {
  it('the label, the count and the screen reader text, with the plural of the listener count', () => {
    expect(translate('ru', 'meetings.homeworkSent')).toBe('Домашнее задание отправили:');
    expect(translate('ru', 'meetings.homeworkSentOf', { sent: 5, listeners: 8 })).toBe('5 из 8');
    const label = (sent: number, count: number) => translate('ru', 'meetings.homeworkSentLabel', { sent, count });
    expect(label(1, 1)).toBe('Домашнее задание отправили 1 из 1 слушателя');
    expect(label(5, 21)).toBe('Домашнее задание отправили 5 из 21 слушателя');
    expect(label(2, 3)).toBe('Домашнее задание отправили 2 из 3 слушателей');
    expect(label(5, 8)).toBe('Домашнее задание отправили 5 из 8 слушателей');
    expect(label(0, 0)).toBe('Домашнее задание отправили 0 из 0 слушателей');
  });
});
