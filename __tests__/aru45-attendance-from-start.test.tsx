// ARU-45: listeners mark attendance as soon as a meeting has started (not only once it is Completed); the owner, the
// teacher and non-listener mentors see the count and the Attendance screen from the same moment; nothing on Canceled
// meetings. Database rules: supabase/tests/aru45_attendance_from_start.test.sql.
// Course A is owned by mentor M; listeners S1 (student) and M2 (mentor); N is a mentor who isn't a listener.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingAttendanceScreen from '@/app/courses/[id]/meetings/[meetingId]/attendance';
import { isOpenForAttendance } from '@/lib/meetings';
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
const R = meeting({ id: 'R' }); // started 10 min ago, still Scheduled
const P = meeting({ id: 'P', startsAt: at(1) }); // starts in 1 min
const D = meeting({ id: 'D', startsAt: at(-600), status: 'completed' });
const X = meeting({ id: 'X', startsAt: at(-60), status: 'canceled' }); // canceled after it started
const meetings = [R, P, D, X];
const members = [member('A', 'S1'), member('A', 'M2')];
const mark = (meetingId: string, userId: string): MeetingAttendance => ({ meetingId, userId, markedAt: at(-5) });
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const store = (who: keyof typeof users, over: Parameters<typeof fakeStore>[1] = {}) =>
  fakeStore(who, { courseMembers: members, meetings, ...over });

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
});
afterEach(() => jest.useRealTimers());

it('isOpenForAttendance: started and not canceled', () => {
  expect([R, P, D, X].map((m) => isOpenForAttendance(m, T0))).toEqual([true, false, true, false]);
  expect(isOpenForAttendance(P, T0 + MIN)).toBe(true);
});

describe('listeners (AC 1, 3, 5, 6)', () => {
  it.each(['S1', 'M2'] as const)('%s sees "I attended" on started and completed meetings, not before the start or when canceled', async (who) => {
    setStore(store(who));
    await render(<CourseDetailScreen />);
    for (const id of ['R', 'D']) expect(inMeeting(id).getByRole('button', { name: 'I attended' })).toBeTruthy();
    for (const id of ['P', 'X']) expect(inMeeting(id).queryByRole('button', { name: 'I attended' })).toBeNull();
  });

  it('tapping marks a started Scheduled meeting', async () => {
    const s = store('S1');
    setStore(s);
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('R').getByRole('button', { name: 'I attended' }));
    expect(s.markAttendance).toHaveBeenCalledWith('R');
  });

  it('after marking: "✓ You attended" and Undo, which asks first', async () => {
    const s = store('S1', { attendance: [mark('R', 'S1')] });
    setStore(s);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Remove')?.onPress?.();
    });
    await render(<CourseDetailScreen />);
    expect(inMeeting('R').getByText(/You attended/)).toBeTruthy();
    await fireEvent.press(inMeeting('R').getByRole('button', { name: 'Undo attendance' }));
    expect(alert).toHaveBeenCalled();
    await waitFor(() => expect(s.unmarkAttendance).toHaveBeenCalledWith('R'));
  });

  it('a mark on a canceled meeting is not shown and cannot be undone', async () => {
    setStore(store('S1', { attendance: [mark('X', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('X').queryByText(/You attended/)).toBeNull();
    expect(inMeeting('X').queryByRole('button', { name: 'Undo attendance' })).toBeNull();
  });

  it('an early tap (device clock ahead) shows the database error', async () => {
    setStore(
      store('S1', {
        markAttendance: jest.fn().mockRejectedValue(new Error('Attendance can be marked once the meeting has started.')),
      }),
    );
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('R').getByRole('button', { name: 'I attended' }));
    expect(await screen.findByText('Attendance can be marked once the meeting has started.')).toBeTruthy();
  });
});

describe('appears on time (AC 2)', () => {
  it('"I attended" appears within 30 seconds of the start, without a refresh', async () => {
    const s = store('S1');
    setStore(s);
    await render(<CourseDetailScreen />);
    expect(inMeeting('P').queryByRole('button', { name: 'I attended' })).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(90 * 1000);
    });
    expect(inMeeting('P').getByRole('button', { name: 'I attended' })).toBeTruthy();
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('the owner\'s count appears at the same time', async () => {
    setStore(store('M'));
    await render(<CourseDetailScreen />);
    expect(inMeeting('P').queryByText(/Attended:/)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(90 * 1000);
    });
    expect(inMeeting('P').getByRole('link', { name: 'Attended 0 of 2' })).toBeTruthy();
  });
});

describe('who attended (AC 7)', () => {
  it.each(['M', 'T', 'N'] as const)('%s sees the count on started and completed meetings only', async (who) => {
    setStore(store(who, { attendance: [mark('R', 'S1'), mark('X', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('R').getByRole('link', { name: 'Attended 1 of 2' })).toBeTruthy();
    expect(inMeeting('D').getByRole('link', { name: 'Attended 0 of 2' })).toBeTruthy();
    for (const id of ['P', 'X']) expect(inMeeting(id).queryByText(/Attended:/)).toBeNull();
  });

  it('the Attendance screen lists who attended a started Scheduled meeting', async () => {
    params.meetingId = 'R';
    setStore(store('M', { attendance: [mark('R', 'S1')] }));
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('Student Sam')).toBeTruthy();
    expect(screen.queryByText('Attendance is available once the meeting has started.')).toBeNull();
  });

  it('before the start: "available once the meeting has started", then the list once it starts', async () => {
    params.meetingId = 'P';
    setStore(store('M'));
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('Attendance is available once the meeting has started.')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(90 * 1000);
    });
    expect(screen.queryByText('Attendance is available once the meeting has started.')).toBeNull();
  });

  it('a canceled meeting: "This meeting was canceled."', async () => {
    params.meetingId = 'X';
    setStore(store('T', { attendance: [mark('X', 'S1')] }));
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('This meeting was canceled.')).toBeTruthy();
    expect(screen.queryByText('Student Sam')).toBeNull();
  });
});
