// ARU-33 QA additions to aru33-meeting-attendance.test.tsx, from the TEST DESIGN: live updates of the count and the
// Attendance screen (AC 7, mark and undo), the mentor who owns one course and listens
// to another (edge case), a mark by someone who isn't a listener never counting (AC 9), and the ARU-28 / ARU-32
// actions staying next to the attendance line on a completed meeting.
import { render, screen, within } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingAttendanceScreen from '@/app/courses/[id]/meetings/[meetingId]/attendance';
import type { Course, Meeting, MeetingAttendance } from '@/lib/types';

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
const members = [member('A', 'S1'), member('A', 'S3'), member('A', 'M2')];
const mark = (meetingId: string, userId: string): MeetingAttendance => ({ meetingId, userId, markedAt: at(-1) });
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const store = (who: keyof typeof users, over: Parameters<typeof fakeStore>[1] = {}) =>
  fakeStore(who, { courseMembers: members, meetings: [C], ...over });

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
});

describe('AC7: live updates', () => {
  it('the count on the course screen follows marks and undos from the store', async () => {
    setStore(store('T'));
    const view = await render(<CourseDetailScreen />);
    expect(inMeeting('C').getByText('Attended: 0 of 3')).toBeTruthy();
    setStore(store('T', { attendance: [mark('C', 'S1'), mark('C', 'M2')] }));
    await view.rerender(<CourseDetailScreen />);
    expect(inMeeting('C').getByText('Attended: 2 of 3')).toBeTruthy();
    setStore(store('T', { attendance: [mark('C', 'M2')] }));
    await view.rerender(<CourseDetailScreen />);
    expect(inMeeting('C').getByText('Attended: 1 of 3')).toBeTruthy();
  });

  it('the Attendance screen moves a listener between Attended and Not marked', async () => {
    params.meetingId = 'C';
    setStore(store('M'));
    const view = await render(<MeetingAttendanceScreen />);
    expect(screen.queryByRole('header', { name: 'Attended' })).toBeNull();
    setStore(store('M', { attendance: [mark('C', 'S3')] }));
    await view.rerender(<MeetingAttendanceScreen />);
    expect(screen.getByRole('header', { name: 'Attended' })).toBeTruthy();
    // Attended (Abby Student) comes before Not marked (Mentor Mo, Student Sam).
    expect(screen.getAllByText(/Mentor Mo|Student Sam|Abby Student/).map((t) => t.props.children)).toEqual([
      'Abby Student',
      'Mentor Mo',
      'Student Sam',
    ]);
    setStore(store('M'));
    await view.rerender(<MeetingAttendanceScreen />);
    expect(screen.queryByRole('header', { name: 'Attended' })).toBeNull();
  });

  it('a listener sees "✓ You attended" turn back into "I attended" after an undo elsewhere', async () => {
    setStore(store('S1', { attendance: [mark('C', 'S1')] }));
    const view = await render(<CourseDetailScreen />);
    expect(inMeeting('C').getByText('✓ You attended')).toBeTruthy();
    setStore(store('S1'));
    await view.rerender(<CourseDetailScreen />);
    expect(inMeeting('C').getByRole('button', { name: 'I attended' })).toBeTruthy();
  });

  it('removed while the screen is open: the button disappears', async () => {
    setStore(store('S1'));
    const view = await render(<CourseDetailScreen />);
    expect(inMeeting('C').getByRole('button', { name: 'I attended' })).toBeTruthy();
    setStore(store('S1', { courseMembers: [member('A', 'S3')] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'I attended' })).toBeNull();
  });
});

it('AC9: a mark by someone who is not a current listener never counts', async () => {
  setStore(store('T', { attendance: [mark('C', 'S2'), mark('C', 'S1')] }));
  await render(<CourseDetailScreen />);
  expect(inMeeting('C').getByText('Attended: 1 of 3')).toBeTruthy();
});

it('edge: a mentor who owns course B and listens to A sees the count on B and "I attended" on A', async () => {
  const courseOwned: Course = { id: 'B', title: 'Biology', description: '', createdById: 'M2', createdAt: at(-200) };
  const onB = meeting({ id: 'CB', courseId: 'B', createdById: 'M2' });
  const both = (id: string) =>
    store('M2', {
      courses: [courseOwned, courseA],
      courseMembers: [...members, member('B', 'S1')],
      meetings: [C, onB],
    });
  params.id = 'A';
  setStore(both('A'));
  const a = await render(<CourseDetailScreen />);
  expect(inMeeting('C').getByRole('button', { name: 'I attended' })).toBeTruthy();
  expect(screen.queryByText(/Attended: /)).toBeNull();
  await a.unmount();
  params.id = 'B';
  setStore(both('B'));
  await render(<CourseDetailScreen />);
  expect(inMeeting('CB').getByText('Attended: 0 of 1')).toBeTruthy();
  expect(inMeeting('CB').queryByRole('button', { name: 'I attended' })).toBeNull();
});

it('ARU-28 / ARU-32 regression: the owner keeps Add notes and Assign homework next to the count', async () => {
  setStore(store('M'));
  await render(<CourseDetailScreen />);
  expect(inMeeting('C').getByRole('button', { name: 'Add notes' })).toBeTruthy();
  expect(inMeeting('C').getByRole('button', { name: 'Assign homework' })).toBeTruthy();
  expect(inMeeting('C').getByText('Attended: 0 of 3')).toBeTruthy();
});
