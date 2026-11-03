// ARU-60: current meetings at the top of the course page; checked and canceled meetings in MEETING HISTORY at the
// bottom. Rules are tested in supabase/tests/aru60_meeting_homework_checked.test.sql.
// Course A owned by mentor M; S1 a student listener and M2 a mentor listener of A; N a mentor not in A; teacher T.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { groupMeetings } from '@/lib/meetings';
import { canCheckMeetingHomework } from '@/lib/roles';
import { formatDate, formatDateTime } from '@/lib/theme';
import type { Meeting } from '@/lib/types';

import { courseA, fakeStore, hw, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24),
  topic: `Topic ${over.id}`,
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-100),
  ...over,
});
const P1 = meeting({ id: 'P1', startsAt: at(-3), topic: 'Started early' });
const P2 = meeting({ id: 'P2', startsAt: at(-1), topic: 'Started later' });
const F1 = meeting({ id: 'F1', startsAt: at(48) });
const F2 = meeting({ id: 'F2', startsAt: at(2) });
const C1 = meeting({ id: 'C1', startsAt: at(-50), status: 'completed', topic: 'Old lesson' });
const C2 = meeting({ id: 'C2', startsAt: at(-20), status: 'completed', topic: 'New lesson' });
const K = meeting({
  id: 'K',
  startsAt: at(-80),
  status: 'completed',
  topic: 'Checked lesson',
  homeworkCheckedAt: '2026-10-30T10:00:00.000Z',
  homeworkCheckedById: 'T',
});
const X = meeting({ id: 'X', startsAt: at(-10), status: 'canceled', topic: 'Dropped' });
const all = [K, F1, C1, X, P2, F2, C2, P1];
const members = [member('A', 'S1'), member('A', 'M2')];

const top = () => screen.getAllByTestId(/^meeting-[A-Z0-9]+$/).filter((n) => !inHistory(n)).map((n) => n.props.testID);
const history = () => within(screen.getByTestId('meeting-history'));
function inHistory(node: { parent: unknown }) {
  for (let n = node as { props?: { testID?: string }; parent: unknown } | null; n; n = n.parent as typeof n) {
    if (n.props?.testID === 'meeting-history') return true;
  }
  return false;
}
const headings = () => screen.getAllByRole('header').map((h) => [h.props.children].flat().join(''));
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const answer = (choice: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === choice)?.onPress?.();
  });

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('groupMeetings', () => {
  it('splits into in progress, upcoming, awaiting check and history, each in its order', () => {
    const now = Date.now();
    const g = groupMeetings(all, now);
    expect(g.inProgress.map((m) => m.id)).toEqual(['P1', 'P2']);
    expect(g.upcoming.map((m) => m.id)).toEqual(['F2', 'F1']);
    expect(g.awaitingCheck.map((m) => m.id)).toEqual(['C2', 'C1']);
    expect(g.history.map((m) => m.id)).toEqual(['X', 'K']);
  });

  it('a future canceled meeting is history, not upcoming', () => {
    const g = groupMeetings([meeting({ id: 'FX', startsAt: at(5), status: 'canceled' })]);
    expect(g.upcoming).toHaveLength(0);
    expect(g.history.map((m) => m.id)).toEqual(['FX']);
  });
});

describe('AC1/AC2: top card and MEETING HISTORY', () => {
  it.each(['S1', 'M', 'N', 'T'] as const)('%s: three groups in order on top, history at the bottom', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: all }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('MEETINGS (6)')).toBeTruthy();
    expect(headings()).toEqual(['In progress', 'Upcoming', 'Awaiting homework check', 'MEETING HISTORY (2)']);
    expect(top()).toEqual(['meeting-P1', 'meeting-P2', 'meeting-F2', 'meeting-F1', 'meeting-C2', 'meeting-C1']);
    expect(history().getAllByTestId(/^meeting-/).map((n) => n.props.testID)).toEqual(['meeting-X', 'meeting-K']);
  });

  // ARU-80: the homework list is gone from course details; MEETING HISTORY is still the last section.
  it('MEETING HISTORY comes last, with no homework list or empty state', async () => {
    // All rendered text, in screen order.
    type Json = { children?: (Json | string)[] | null } | string | null;
    const texts = (n: Json): string[] =>
      !n ? [] : typeof n === 'string' ? [n] : (n.children ?? []).flatMap((c) => texts(c));
    const rendered = () => texts(screen.toJSON() as Json).join('|');
    const before = (a: string, b: string) => {
      const text = rendered();
      expect(text.indexOf(a)).toBeGreaterThan(-1);
      expect(text.indexOf(a)).toBeLessThan(text.indexOf(b));
    };
    setStore(fakeStore('T', { courseMembers: members, meetings: all, visibleHomework: [] }));
    const view = await render(<CourseDetailScreen />);
    before('MEETINGS (', 'MEETING HISTORY');
    expect(rendered()).not.toContain('HOMEWORK');
    expect(rendered()).not.toContain('No homework for this course yet');
    setStore(fakeStore('T', { courseMembers: members, meetings: all, visibleHomework: [hw({ id: 'h1', courseId: 'A', title: 'Sam answer' })] }));
    await view.rerender(<CourseDetailScreen />);
    expect(rendered()).not.toContain('Sam answer');
    expect(headings().at(-1)).toBe('MEETING HISTORY (2)');
  });

  it('an empty group has no heading; no history → no MEETING HISTORY section', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [F1, C1] }));
    await render(<CourseDetailScreen />);
    expect(headings()).toEqual(['Upcoming', 'Awaiting homework check']);
    expect(screen.queryByTestId('meeting-history')).toBeNull();
  });

  it('no meetings: "No meetings scheduled yet" and no history', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('No meetings scheduled yet')).toBeTruthy();
    expect(screen.queryByTestId('meeting-history')).toBeNull();
  });

  it.each(['M', 'T'] as const)('%s: everything in history → "No current meetings", still with + Schedule meeting', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: [K, X] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('MEETINGS (0)')).toBeTruthy();
    expect(screen.getByText('No current meetings')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Schedule meeting' })).toBeTruthy();
    expect(screen.getByText('MEETING HISTORY (2)')).toBeTruthy();
  });
});

describe('AC3/AC4: status changes move meetings live', () => {
  it('canceling moves a meeting to history; completing moves it to Awaiting homework check', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [F2, P1] }));
    const view = await render(<CourseDetailScreen />);
    expect(screen.queryByTestId('meeting-history')).toBeNull();
    setStore(fakeStore('S1', { courseMembers: members, meetings: [{ ...F2, status: 'canceled' }, { ...P1, status: 'completed' }] }));
    await view.rerender(<CourseDetailScreen />);
    expect(history().getByTestId('meeting-F2')).toBeTruthy();
    expect(headings()).toEqual(['Awaiting homework check', 'MEETING HISTORY (1)']);
    expect(top()).toEqual(['meeting-P1']);
  });

  it('an upcoming meeting becomes In progress once its start passes, without new data', async () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      const soon = meeting({ id: 'SO', startsAt: new Date(Date.now() + 30 * 1000).toISOString() });
      setStore(fakeStore('S1', { courseMembers: members, meetings: [soon] }));
      await render(<CourseDetailScreen />);
      expect(headings()).toEqual(['Upcoming']);
      await act(async () => {
        jest.advanceTimersByTime(90 * 1000);
      });
      expect(headings()).toEqual(['In progress']);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AC5/AC6/AC7: mark homework checked and undo', () => {
  it.each(['T', 'N', 'M'] as const)('%s marks after confirming; the store call follows', async (who) => {
    const alert = answer('Mark checked');
    const store = fakeStore(who, { courseMembers: members, meetings: all });
    setStore(store);
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C2').getByRole('button', { name: 'Mark homework checked' }));
    expect(alert.mock.calls[0][0]).toBe('Mark homework checked');
    expect(alert.mock.calls[0][1]).toBe(`Mark homework for New lesson on ${formatDateTime(C2.startsAt)} as checked?`);
    await waitFor(() => expect(store.setMeetingHomeworkChecked).toHaveBeenCalledWith('C2', true));
  });

  it('dismissing the confirmation changes nothing', async () => {
    answer('Not now');
    const store = fakeStore('T', { courseMembers: members, meetings: all });
    setStore(store);
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C2').getByRole('button', { name: 'Mark homework checked' }));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(store.setMeetingHomeworkChecked).not.toHaveBeenCalled();
  });

  it('a live update moves the checked meeting to history with "Homework checked by <name> · <date>"', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C2] }));
    const view = await render(<CourseDetailScreen />);
    const checked = { ...C2, homeworkCheckedAt: '2026-11-02T09:00:00.000Z', homeworkCheckedById: 'N' };
    setStore(fakeStore('S1', { courseMembers: members, meetings: [checked] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.getByText('No current meetings')).toBeTruthy();
    expect(history().getByText('Completed')).toBeTruthy();
    expect(history().getByText(`Homework checked by Mentor Nina · ${formatDate(checked.homeworkCheckedAt)}`)).toBeTruthy();
  });

  it('the checker shows as "Unknown" when their profile can\'t be read', async () => {
    const ghost = { ...K, homeworkCheckedById: 'gone' };
    setStore(fakeStore('S1', { courseMembers: members, meetings: [ghost] }));
    await render(<CourseDetailScreen />);
    expect(history().getByText(`Homework checked by Unknown · ${formatDate(K.homeworkCheckedAt!)}`)).toBeTruthy();
  });

  it('canceled meetings show no "checked" line and no check actions', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings: [X] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByTestId('checked-X')).toBeNull();
    expect(inMeeting('X').queryByRole('button', { name: /check/i })).toBeNull();
  });

  it.each(['T', 'N'] as const)('%s undoes a check after confirming', async (who) => {
    const alert = answer('Undo check');
    const store = fakeStore(who, { courseMembers: members, meetings: all });
    setStore(store);
    await render(<CourseDetailScreen />);
    await fireEvent.press(history().getByRole('button', { name: 'Undo check' }));
    expect(alert.mock.calls[0][0]).toBe('Undo check');
    await waitFor(() => expect(store.setMeetingHomeworkChecked).toHaveBeenCalledWith('K', false));
  });

  it('a database error shows in the section\'s error text and the meeting stays where it was', async () => {
    answer('Mark checked');
    const setMeetingHomeworkChecked = jest.fn(async () => {
      throw new Error('Only the teacher or a mentor who isn\'t a listener of this course can mark homework checked.');
    });
    setStore(fakeStore('N', { courseMembers: members, meetings: all, setMeetingHomeworkChecked }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C2').getByRole('button', { name: 'Mark homework checked' }));
    expect(await screen.findByText(/can mark homework checked/)).toBeTruthy();
    expect(top()).toContain('meeting-C2');
  });
});

describe('AC8/AC9: who sees the check actions; the rest is unchanged', () => {
  it.each(['S1', 'M2'] as const)('%s (listener) sees neither Mark homework checked nor Undo check', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: all }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Mark homework checked' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo check' })).toBeNull();
  });

  it('scheduled meetings never offer Mark homework checked', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings: [P1, F1] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Mark homework checked' })).toBeNull();
  });

  it('canCheckMeetingHomework mirrors the database rule', () => {
    expect(canCheckMeetingHomework(users.T, courseA, members)).toBe(true);
    expect(canCheckMeetingHomework(users.M, courseA, members)).toBe(true);
    expect(canCheckMeetingHomework(users.N, courseA, members)).toBe(true);
    expect(canCheckMeetingHomework(users.M2, courseA, members)).toBe(false);
    expect(canCheckMeetingHomework(users.S1, courseA, members)).toBe(false);
    expect(canCheckMeetingHomework(users.S2, courseA, members)).toBe(false);
    expect(canCheckMeetingHomework(null, courseA, members)).toBe(false);
  });

  it('a checked meeting in history keeps notes, homework and attendance actions for the owner', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [{ ...K, notes: 'Covered' }] }));
    await render(<CourseDetailScreen />);
    const labels = history()
      .queryAllByRole(/button|link/)
      .map((b) => b.props.accessibilityLabel);
    expect(labels).toEqual(['Notes', 'Edit notes', 'Assign homework', 'Attended 0 of 2', 'Undo check']);
  });
});
