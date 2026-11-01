// QA ARU-45: gaps in the dev tests: a meeting rescheduled into the future after marks, notes and homework staying
// Completed-only on a started meeting (ARU-28 / ARU-32 regression), live count updates on a started meeting, and the
// Attendance screen opening at the start time.
import { act, render, screen, within } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingAttendanceScreen from '@/app/courses/[id]/meetings/[meetingId]/attendance';
import type { Meeting, MeetingAttendance } from '@/lib/types';

import { fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const MIN = 60 * 1000;
const T0 = new Date('2026-11-01T10:00:00.000Z').getTime();
const at = (min: number) => new Date(T0 + min * MIN).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(-10),
  topic: `Topic ${over.id}`,
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-1000),
  ...over,
});
const members = [member('A', 'S1'), member('A', 'M2')];
const mark = (meetingId: string, userId: string): MeetingAttendance => ({ meetingId, userId, markedAt: at(-5) });
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const store = (who: keyof typeof users, meetings: Meeting[], over: Parameters<typeof fakeStore>[1] = {}) =>
  fakeStore(who, { courseMembers: members, meetings, ...over });

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
});
afterEach(() => jest.useRealTimers());

describe('edge case: rescheduled into the future after S1 marked it', () => {
  // The owner moved R from 10 min ago to tomorrow; S1's mark is still stored.
  const R = meeting({ id: 'R', startsAt: at(24 * 60), rescheduledAt: at(-1) });

  it('S1 sees neither "✓ You attended" nor Undo nor I attended', async () => {
    setStore(store('S1', [R], { attendance: [mark('R', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('R').queryByText(/You attended/)).toBeNull();
    expect(inMeeting('R').queryByRole('button', { name: /Undo|I attended/ })).toBeNull();
  });

  it('the owner sees no count, and the Attendance screen says it opens at the start', async () => {
    setStore(store('M', [R], { attendance: [mark('R', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('R').queryByText(/Attended/)).toBeNull();
    params.meetingId = 'R';
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('Attendance is available once the meeting has started.')).toBeTruthy();
    expect(screen.queryByText('Student Sam')).toBeNull();
  });

  it('at the new start the kept mark shows again, without a refresh', async () => {
    setStore(store('S1', [meeting({ id: 'R', startsAt: at(1) })], { attendance: [mark('R', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('R').queryByText(/You attended/)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(90 * 1000);
    });
    expect(inMeeting('R').getByText(/You attended/)).toBeTruthy();
    expect(inMeeting('R').getByRole('button', { name: 'Undo attendance' })).toBeTruthy();
  });
});

describe('regression: notes and homework stay Completed-only', () => {
  it.each(['M', 'T'] as const)('%s on a started Scheduled meeting: count, but no notes or Assign homework', async (who) => {
    setStore(store(who, [meeting({ id: 'R', notes: undefined })]));
    await render(<CourseDetailScreen />);
    expect(inMeeting('R').getByText('Attended: 0 of 2')).toBeTruthy();
    expect(inMeeting('R').queryByText(/Add notes|Edit notes/)).toBeNull();
    expect(inMeeting('R').queryByRole('button', { name: 'Assign homework' })).toBeNull();
  });
});

describe('AC 8: live on a started meeting', () => {
  it('the owner\'s count and the Attendance screen follow a mark and an undo', async () => {
    const R = meeting({ id: 'R' });
    setStore(store('M', [R]));
    const card = await render(<CourseDetailScreen />);
    expect(inMeeting('R').getByText('Attended: 0 of 2')).toBeTruthy();
    setStore(store('M', [R], { attendance: [mark('R', 'S1'), mark('R', 'M2')] }));
    await card.rerender(<CourseDetailScreen />);
    expect(inMeeting('R').getByText('Attended: 2 of 2')).toBeTruthy();
    await card.unmount();

    params.meetingId = 'R';
    setStore(store('M', [R], { attendance: [mark('R', 'S1')] }));
    const list = await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('Student Sam')).toBeTruthy();
    setStore(store('M', [R], { attendance: [] }));
    await list.rerender(<MeetingAttendanceScreen />);
    expect(screen.queryByText(/ATTENDED \(1\)/)).toBeNull();
  });
});

describe('AC 7: the Attendance screen opens at the start time', () => {
  it('N (a mentor who is not a listener) gets the list once the clock passes the start', async () => {
    params.meetingId = 'K';
    setStore(store('N', [meeting({ id: 'K', startsAt: at(1) })], { attendance: [] }));
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('Attendance is available once the meeting has started.')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(90 * 1000);
    });
    expect(screen.queryByText('Attendance is available once the meeting has started.')).toBeNull();
    expect(screen.getByText('Student Sam')).toBeTruthy();
  });
});
