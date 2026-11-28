// ARU-190: a Completed meeting with no homework moves to MEETING HISTORY by itself 24 hours after it was marked
// Completed (display only, nothing is saved). Course A owned by mentor M; S1 a student listener and M2 a mentor
// listener of A; N a mentor not in A; teacher T.
import { act, render, screen, within } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { AUTO_HISTORY_MS, groupMeetings } from '@/lib/meetings';
import type { HomeworkAssignment, Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-11-28T12:00:00.000Z');
const ago = (ms: number, now = NOW) => new Date(now - ms).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: ago(30 * HOUR),
  topic: `Topic ${over.id}`,
  status: 'completed',
  createdById: 'M',
  createdAt: ago(100 * HOUR),
  ...over,
});
const asg = (meetingId: string): HomeworkAssignment => ({
  id: `a-${meetingId}`,
  meetingId,
  courseId: 'A',
  title: `Homework for ${meetingId}`,
  description: '',
  createdById: 'M',
  createdAt: ago(HOUR),
});
const ids = (ms: Meeting[]) => ms.map((m) => m.id);
const members = [member('A', 'S1'), member('A', 'M2')];

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('groupMeetings (ARU-190)', () => {
  const none = new Set<string>();

  it('AC 2: no homework, 23 h 59 min after Completed → Awaiting homework check', () => {
    const m = meeting({ id: 'W', statusChangedAt: ago(24 * HOUR - MIN) });
    const g = groupMeetings([m], NOW, none);
    expect(ids(g.awaitingCheck)).toEqual(['W']);
    expect(g.history).toHaveLength(0);
  });

  it('AC 1: no homework, exactly 24 h after Completed → history', () => {
    const m = meeting({ id: 'H', statusChangedAt: ago(AUTO_HISTORY_MS) });
    const g = groupMeetings([m], NOW, none);
    expect(g.awaitingCheck).toHaveLength(0);
    expect(ids(g.history)).toEqual(['H']);
  });

  it('AC 4: with homework, 48 h and 7 days after Completed → still Awaiting homework check', () => {
    const a = meeting({ id: 'A1', statusChangedAt: ago(48 * HOUR) });
    const b = meeting({ id: 'A2', startsAt: ago(8 * 24 * HOUR), statusChangedAt: ago(7 * 24 * HOUR) });
    const g = groupMeetings([a, b], NOW, new Set(['A1', 'A2']));
    expect(ids(g.awaitingCheck)).toEqual(['A1', 'A2']);
    expect(g.history).toHaveLength(0);
  });

  it('checked → history, as today', () => {
    const k = meeting({ id: 'K', statusChangedAt: ago(HOUR), homeworkCheckedAt: ago(MIN), homeworkCheckedById: 'T' });
    expect(ids(groupMeetings([k], NOW, new Set(['K'])).history)).toEqual(['K']);
  });

  it('homework list not loaded (null) → never moves', () => {
    const m = meeting({ id: 'N', statusChangedAt: ago(72 * HOUR) });
    expect(ids(groupMeetings([m], NOW, null).awaitingCheck)).toEqual(['N']);
    expect(ids(groupMeetings([m], NOW).awaitingCheck)).toEqual(['N']);
  });

  it('AC 9: missing statusChangedAt → Awaiting homework check', () => {
    const m = meeting({ id: 'Z', statusChangedAt: undefined });
    expect(ids(groupMeetings([m], NOW, none).awaitingCheck)).toEqual(['Z']);
  });

  it('counts from statusChangedAt, not the start time', () => {
    const m = meeting({ id: 'L', startsAt: ago(10 * 24 * HOUR), statusChangedAt: ago(2 * HOUR) });
    expect(ids(groupMeetings([m], NOW, none).awaitingCheck)).toEqual(['L']);
  });

  it('AC 1 / AC 9: history stays newest first by start time, mixed with canceled and checked meetings', () => {
    const auto = meeting({ id: 'AU', startsAt: ago(40 * HOUR), statusChangedAt: ago(30 * HOUR) });
    const x = meeting({ id: 'X', startsAt: ago(20 * HOUR), status: 'canceled' });
    const k = meeting({ id: 'K', startsAt: ago(60 * HOUR), homeworkCheckedAt: ago(HOUR), homeworkCheckedById: 'T' });
    const g = groupMeetings([k, auto, x], NOW, none);
    expect(ids(g.history)).toEqual(['X', 'AU', 'K']);
  });
});

describe('course page (ARU-190)', () => {
  const history = () => within(screen.getByTestId('meeting-history'));
  const headings = () => screen.getAllByRole('header').map((h) => [h.props.children].flat().join(''));

  it.each(['S1', 'M2', 'M', 'N', 'T'] as const)(
    '%s: AC 1 / AC 7 / AC 8 — the old no-homework meeting is in MEETING HISTORY, counted, Completed badge',
    async (who) => {
      const auto = meeting({ id: 'AU', statusChangedAt: ago(25 * HOUR, Date.now()) });
      const fresh = meeting({ id: 'FR', startsAt: ago(2 * HOUR, Date.now()), statusChangedAt: ago(HOUR, Date.now()) });
      setStore(fakeStore(who, { courseMembers: members, meetings: [auto, fresh], assignments: [] }));
      await render(<CourseDetailScreen />);
      expect(headings()).toEqual(['AWAITING HOMEWORK CHECK (1)', 'MEETING HISTORY (1)']);
      expect(history().getByTestId('meeting-AU')).toBeTruthy();
      expect(within(screen.getByTestId('meeting-AU')).getByText('Completed')).toBeTruthy();
      expect(within(screen.getByTestId('meeting-AU')).queryByText(/Homework sent/)).toBeNull();
    },
  );

  it.each(['M', 'T'] as const)('%s: AC 5 / AC 6 — Assign homework but no Mark checked on the auto-history tile', async (who) => {
    const auto = meeting({ id: 'AU', statusChangedAt: ago(25 * HOUR, Date.now()) });
    setStore(fakeStore(who, { courseMembers: members, meetings: [auto], assignments: [] }));
    await render(<CourseDetailScreen />);
    const tile = history();
    expect(tile.getByRole('button', { name: 'Assign homework' })).toBeTruthy();
    expect(tile.queryByRole('button', { name: 'Mark homework checked' })).toBeNull();
  });

  it('AC 5: homework set later brings the meeting back to Awaiting homework check', async () => {
    const auto = meeting({ id: 'AU', statusChangedAt: ago(25 * HOUR, Date.now()) });
    setStore(fakeStore('T', { courseMembers: members, meetings: [auto], assignments: [] }));
    const view = await render(<CourseDetailScreen />);
    expect(headings()).toEqual(['MEETING HISTORY (1)']);
    setStore(fakeStore('T', { courseMembers: members, meetings: [auto], assignments: [asg('AU')] }));
    await view.rerender(<CourseDetailScreen />);
    expect(headings()).toEqual(['AWAITING HOMEWORK CHECK (1)']);
    expect(screen.queryByTestId('meeting-history')).toBeNull();
    expect(
      within(screen.getByTestId('meeting-AU')).getByRole('button', { name: 'Mark homework checked' }),
    ).toBeTruthy();
  });

  it('AC 3: moves on its own when the 24 hours pass, without new data', async () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      const m = meeting({ id: 'TK', statusChangedAt: ago(AUTO_HISTORY_MS - 30 * 1000, Date.now()) });
      setStore(fakeStore('S1', { courseMembers: members, meetings: [m], assignments: [] }));
      await render(<CourseDetailScreen />);
      expect(headings()).toEqual(['AWAITING HOMEWORK CHECK (1)']);
      await act(async () => {
        jest.advanceTimersByTime(90 * 1000);
      });
      expect(headings()).toEqual(['MEETING HISTORY (1)']);
    } finally {
      jest.useRealTimers();
    }
  });
});
