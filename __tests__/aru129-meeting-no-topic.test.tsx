// ARU-129: meetings have no topic; a meeting is named by its date and time everywhere. An old topic ("Algebra
// basics") is still in the data but never shown. Course A owned by mentor M; S1 a student listener of A.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import AssignHomeworkScreen from '@/app/courses/[id]/meetings/[meetingId]/assign-homework';
import MeetingAttendanceScreen from '@/app/courses/[id]/meetings/[meetingId]/attendance';
import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import { formatDateTime } from '@/lib/theme';
import type { Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/components/DateTimeField', () => {
  const { TextInput } = require('react-native');
  return {
    DateTimeField: ({ value, onChange }: { value: Date; onChange: (d: Date) => void }) => (
      <TextInput testID="deadline" value={value.toISOString()} onChangeText={(t: string) => onChange(new Date(t))} />
    ),
  };
});

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const TOPIC = 'Algebra basics';
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24),
  topic: TOPIC,
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-100),
  ...over,
});
const C = meeting({ id: 'C', startsAt: at(-30), status: 'completed' });
const F = meeting({ id: 'F', startsAt: at(5) });
const P = meeting({ id: 'P', startsAt: at(-1) });
const members = [member('A', 'S1')];
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
  params.edit = undefined;
});

it('AC 2 / AC 5: the tiles show the date and time, never the stored topic', async () => {
  setStore(fakeStore('M', { courseMembers: members, meetings: [C, F, P] }));
  await render(<CourseDetailScreen />);
  for (const m of [C, F, P]) expect(inMeeting(m.id).getByText(formatDateTime(m.startsAt))).toBeTruthy();
  expect(screen.queryByText(new RegExp(TOPIC))).toBeNull();
});

it('AC 2: the Notes page title and the notes editor header are the date and time', async () => {
  params.meetingId = 'C';
  setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
  const view = await render(<MeetingNotesScreen />);
  expect(screen.getByText(formatDateTime(C.startsAt))).toBeTruthy();
  expect(screen.queryByText(new RegExp(TOPIC))).toBeNull();
  await view.unmount();

  params.edit = '1';
  await render(<MeetingNotesScreen />);
  expect(screen.getByText(formatDateTime(C.startsAt))).toBeTruthy();
  expect(screen.queryByText(new RegExp(TOPIC))).toBeNull();
});

it('AC 2: the Attendance page title is the date and time', async () => {
  params.meetingId = 'C';
  setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
  await render(<MeetingAttendanceScreen />);
  expect(screen.getByText(formatDateTime(C.startsAt))).toBeTruthy();
  expect(screen.queryByText(new RegExp(TOPIC))).toBeNull();
});

it('AC 2: the Assign homework header is "<course> · <date and time>"', async () => {
  params.meetingId = 'C';
  setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
  await render(<AssignHomeworkScreen />);
  expect(screen.getByText(`Algebra · ${formatDateTime(C.startsAt)}`)).toBeTruthy();
  expect(screen.queryByText(new RegExp(TOPIC))).toBeNull();
});

describe('AC 3: confirmation messages name the meeting by its date and time', () => {
  const message = () => (Alert.alert as jest.Mock).mock.calls[0][1];
  beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('mark completed and mark canceled (in progress)', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [P] }));
    const view = await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('P').getByRole('button', { name: 'Mark completed' }));
    expect(message()).toBe(`Mark the meeting on ${formatDateTime(P.startsAt)} as completed?`);
    await view.unmount();
    (Alert.alert as jest.Mock).mockClear();
    await render(<CourseDetailScreen />);
    // ARU-126 AC 9: the in-progress cancel is the single ✕ labelled "Cancel meeting".
    await fireEvent.press(inMeeting('P').getByRole('button', { name: 'Cancel meeting' }));
    expect(message()).toBe(`Mark the meeting on ${formatDateTime(P.startsAt)} as canceled?`);
  });

  it('cancel meeting (upcoming)', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [F] }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('F').getByRole('button', { name: 'Cancel meeting' }));
    expect(message()).toBe(`Mark the meeting on ${formatDateTime(F.startsAt)} as canceled?`);
  });

  it('mark homework checked', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C').getByRole('button', { name: 'Mark homework checked' }));
    expect(message()).toBe(`Mark homework for the meeting on ${formatDateTime(C.startsAt)} as checked?`);
  });

  it('a checked meeting has no Undo check (ARU-126 AC 8), so there is no undo confirmation', async () => {
    const K = { ...C, id: 'K', homeworkCheckedAt: at(-2), homeworkCheckedById: 'M' };
    setStore(fakeStore('M', { courseMembers: members, meetings: [K] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Undo check' })).toBeNull();
  });

  it('remove attendance (listener)', async () => {
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        meetings: [C],
        attendance: [{ meetingId: 'C', userId: 'S1', markedAt: at(-29) }],
      }),
    );
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('C').getByRole('button', { name: 'Undo attendance' }));
    await waitFor(() => expect(message()).toBe(`Remove your attendance for the meeting on ${formatDateTime(C.startsAt)}?`));
  });
});
