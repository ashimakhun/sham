// ARU-33: listeners mark attendance of completed meetings; the owner, the teacher and mentors see who attended.
// Access rules: supabase/tests/aru33_meeting_attendance.test.sql. Course A is owned by mentor M; listeners S1 (student),
// S3 (student) and M2 (mentor); N is a mentor who isn't a listener; S2 a student who isn't; T the teacher.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingAttendanceScreen from '@/app/courses/[id]/meetings/[meetingId]/attendance';
import { meetingAttendance } from '@/lib/attendance';
import { canMarkAttendance, canSeeAttendance } from '@/lib/roles';
import { formatDateTime } from '@/lib/theme';
import type { Meeting, MeetingAttendance } from '@/lib/types';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(-30),
  topic: `Topic ${over.id}`,
  status: 'completed',
  createdById: 'M',
  createdAt: at(-100),
  ...over,
});
const C = meeting({ id: 'C', topic: 'Done' });
const S = meeting({ id: 'S', startsAt: at(24), status: 'scheduled' });
const ST = meeting({ id: 'ST', startsAt: at(-1), status: 'scheduled' });
const X = meeting({ id: 'X', startsAt: at(-5), status: 'canceled' });
const meetings = [C, S, ST, X];
const members = [member('A', 'S1'), member('A', 'S3'), member('A', 'M2')];
const mark = (meetingId: string, userId: string): MeetingAttendance => ({ meetingId, userId, markedAt: at(-1) });
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const store = (who: keyof typeof users, over: Parameters<typeof fakeStore>[1] = {}) =>
  fakeStore(who, { courseMembers: members, meetings, ...over });
const answer = (choice: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((b) => b.text === choice)?.onPress?.();
  });

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
});

describe('roles helpers', () => {
  it('only current listeners mark, only on completed meetings', () => {
    for (const who of ['S1', 'M2'] as const) {
      expect(canMarkAttendance(users[who], courseA, members, C)).toBe(true);
      for (const m of [S, ST, X]) expect(canMarkAttendance(users[who], courseA, members, m)).toBe(false);
    }
    for (const who of ['S2', 'N', 'M', 'T'] as const) expect(canMarkAttendance(users[who], courseA, members, C)).toBe(false);
  });

  it('the owner, the teacher and non-listener mentors see attendance; listeners don\'t', () => {
    for (const who of ['M', 'T', 'N'] as const) expect(canSeeAttendance(users[who], courseA, members)).toBe(true);
    for (const who of ['S1', 'M2', 'S2'] as const) expect(canSeeAttendance(users[who], courseA, members)).toBe(false);
    expect(canSeeAttendance(null, courseA, members)).toBe(false);
  });

  it('AC9: counts only current listeners', () => {
    const marks = [mark('C', 'S1'), mark('C', 'S2'), mark('S', 'S3')]; // S2 was removed; S3 marked another meeting
    expect(meetingAttendance('C', 'A', members, marks)).toEqual({ attended: ['S1'], notMarked: ['S3', 'M2'], total: 3 });
  });
});

describe('listener marks attendance (AC1–AC5)', () => {
  it.each(['S1', 'M2'] as const)('AC1: %s sees "I attended" on the completed meeting only', async (who) => {
    setStore(store(who));
    await render(<CourseDetailScreen />);
    expect(inMeeting('C').getByRole('button', { name: 'I attended' })).toBeTruthy();
    for (const id of ['S', 'ST', 'X']) expect(inMeeting(id).queryByRole('button', { name: 'I attended' })).toBeNull();
    expect(screen.queryByText(/Attended: /)).toBeNull();
  });

  it('AC2: tapping marks the meeting', async () => {
    const markAttendance = jest.fn(async () => {});
    setStore(store('S1', { markAttendance }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C').getByRole('button', { name: 'I attended' }));
    expect(markAttendance).toHaveBeenCalledWith('C');
  });

  it('AC2: once marked, shows "✓ You attended" and Undo instead of the button', async () => {
    setStore(store('S1', { attendance: [mark('C', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('C').getByText('✓ You attended')).toBeTruthy();
    expect(inMeeting('C').getByRole('button', { name: 'Undo attendance' })).toBeTruthy();
    expect(inMeeting('C').queryByRole('button', { name: 'I attended' })).toBeNull();
  });

  it('AC2: another listener\'s mark doesn\'t count as mine', async () => {
    setStore(store('S1', { attendance: [mark('C', 'S3')] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('C').getByRole('button', { name: 'I attended' })).toBeTruthy();
  });

  it('AC2/AC4: a failed save keeps the button and shows the error under the card', async () => {
    const markAttendance = jest.fn(async () => {
      throw new Error('Attendance can be marked only for completed meetings.');
    });
    setStore(store('S1', { markAttendance }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C').getByRole('button', { name: 'I attended' }));
    expect(await screen.findByText('Attendance can be marked only for completed meetings.')).toBeTruthy();
    expect(inMeeting('C').getByRole('button', { name: 'I attended' })).toBeTruthy();
  });

  it('AC3: Undo asks first; "Not now" changes nothing', async () => {
    const alert = answer('Not now');
    const unmarkAttendance = jest.fn(async () => {});
    setStore(store('S1', { attendance: [mark('C', 'S1')], unmarkAttendance }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C').getByRole('button', { name: 'Undo attendance' }));
    expect(alert).toHaveBeenCalledWith(
      'Undo attendance',
      `Remove your attendance for Done on ${formatDateTime(C.startsAt)}?`,
      expect.arrayContaining([expect.objectContaining({ text: 'Remove' }), expect.objectContaining({ text: 'Not now' })]),
      expect.any(Object),
    );
    expect(unmarkAttendance).not.toHaveBeenCalled();
  });

  it('AC3: "Remove" removes the mark', async () => {
    answer('Remove');
    const unmarkAttendance = jest.fn(async () => {});
    setStore(store('S1', { attendance: [mark('C', 'S1')], unmarkAttendance }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C').getByRole('button', { name: 'Undo attendance' }));
    await waitFor(() => expect(unmarkAttendance).toHaveBeenCalledWith('C'));
  });

  it('AC3: a rejected Undo shows the error', async () => {
    answer('Remove');
    const unmarkAttendance = jest.fn(async () => {
      throw new Error('Only listeners of this course can mark attendance.');
    });
    setStore(store('S1', { attendance: [mark('C', 'S1')], unmarkAttendance }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C').getByRole('button', { name: 'Undo attendance' }));
    expect(await screen.findByText('Only listeners of this course can mark attendance.')).toBeTruthy();
  });

  it.each(['S2', 'M', 'T', 'N'] as const)('AC5: %s (not a listener) sees no "I attended"', async (who) => {
    setStore(store(who));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'I attended' })).toBeNull();
  });
});

describe('owner, teacher and mentors see attendance (AC6, AC8)', () => {
  it.each(['M', 'T', 'N'] as const)('AC6: %s sees "Attended: X of Y" on the completed meeting only', async (who) => {
    setStore(store(who, { attendance: [mark('C', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('C').getByText('Attended: 1 of 3')).toBeTruthy();
    expect(inMeeting('C').getByRole('link', { name: 'Attended 1 of 3' })).toBeTruthy();
    for (const id of ['S', 'ST', 'X']) expect(inMeeting(id).queryByText(/Attended/)).toBeNull();
  });

  it('AC6: tapping the count opens the Attendance screen', async () => {
    setStore(store('M'));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C').getByRole('link', { name: 'Attended 0 of 3' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/attendance',
      params: { id: 'A', meetingId: 'C' },
    });
  });

  it('AC8: a mentor listener sees only their own mark, no count', async () => {
    setStore(store('M2', { attendance: [mark('C', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByText(/Attended: /)).toBeNull();
    expect(inMeeting('C').getByRole('button', { name: 'I attended' })).toBeTruthy();
  });
});

describe('Attendance screen (AC6, AC8, AC9)', () => {
  beforeEach(() => {
    params.meetingId = 'C';
  });

  it('AC6: date, time, topic and listeners sorted by name under Attended / Not marked with roles', async () => {
    setStore(store('T', { attendance: [mark('C', 'S1'), mark('C', 'M2')] }));
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText(formatDateTime(C.startsAt))).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Attended' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Not marked' })).toBeTruthy();
    const names = screen.getAllByText(/Mentor Mo|Student Sam|Abby Student/).map((t) => t.props.children);
    expect(names).toEqual(['Mentor Mo', 'Student Sam', 'Abby Student']); // Attended (by name), then Not marked
    expect(screen.getAllByText('Student').length).toBe(2);
    expect(screen.getAllByText('Mentor').length).toBe(1);
  });

  it('AC6: a heading is hidden when its list is empty', async () => {
    setStore(store('M'));
    await render(<MeetingAttendanceScreen />);
    expect(screen.queryByRole('header', { name: 'Attended' })).toBeNull();
    expect(screen.getByRole('header', { name: 'Not marked' })).toBeTruthy();
  });

  it('AC6: a course with no listeners', async () => {
    setStore(store('M', { courseMembers: [] }));
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('This course has no listeners.')).toBeTruthy();
  });

  it('AC9: a removed listener is not listed', async () => {
    setStore(store('M', { courseMembers: [member('A', 'S3')], attendance: [mark('C', 'S1')] }));
    await render(<MeetingAttendanceScreen />);
    expect(screen.queryByText('Student Sam')).toBeNull();
    expect(screen.getByText('Abby Student')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Attended' })).toBeNull();
  });

  it.each(['S1', 'M2'] as const)('AC8: %s (a listener) is told only staff can see attendance', async (who) => {
    setStore(store(who, { attendance: [mark('C', 'S1')] }));
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('Only the course owner, the teacher and mentors can see attendance.')).toBeTruthy();
    expect(screen.queryByText('Student Sam')).toBeNull();
  });

  it('an unknown meeting shows "Meeting not found"', async () => {
    params.meetingId = 'nope';
    setStore(store('M'));
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('Meeting not found')).toBeTruthy();
  });

  it('a scheduled or canceled meeting shows that attendance is for completed meetings', async () => {
    params.meetingId = 'X';
    setStore(store('M'));
    await render(<MeetingAttendanceScreen />);
    expect(screen.getByText('Attendance is available only for completed meetings.')).toBeTruthy();
  });
});
