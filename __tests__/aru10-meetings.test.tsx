// ARU-10: course meetings (UI side). Rules are tested in supabase/tests/aru10_course_meetings.test.sql.
// Course A owned by mentor M, course T1 owned by teacher T; N a mentor with no link; S1 a student listener of A;
// S2 a student in nothing.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import ScheduleMeetingScreen from '@/app/courses/[id]/meetings/new';
import { hasStarted, isLink, sortMeetings } from '@/lib/meetings';
import { formatDateTime } from '@/lib/theme';
import type { Course, Meeting } from '@/lib/types';
import { router } from 'expo-router';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
// The native picker isn't available in jest: a text box that takes an ISO date stands in for it.
jest.mock('@/components/DateTimeField', () => {
  const { TextInput } = require('react-native');
  return {
    DateTimeField: ({ value, onChange }: { value: Date; onChange: (d: Date) => void }) => (
      <TextInput testID="starts-at" value={value.toISOString()} onChangeText={(t: string) => onChange(new Date(t))} />
    ),
  };
});

const HOUR = 60 * 60 * 1000;
const at = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24),
  topic: `Topic ${over.id}`,
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-48),
  ...over,
});
const courseT1: Course = { id: 'T1', title: 'Teaching', description: '', createdById: 'T', createdAt: courseA.createdAt };
const members = [member('A', 'S1')];

const future = meeting({ id: 'F', topic: 'Future', location: 'https://meet.example/x' });
const pastUnmarked = meeting({ id: 'P', topic: 'Past', startsAt: at(-2), location: 'Room 12' });
const completed = meeting({ id: 'C', topic: 'Done', startsAt: at(-30), status: 'completed' });
const canceled = meeting({ id: 'X', topic: 'Dropped', startsAt: at(-5), status: 'canceled' });
const soon = meeting({ id: 'S', topic: 'Soon', startsAt: at(1) });
const all = [completed, future, canceled, pastUnmarked, soon];

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('Meetings section', () => {
  it('AC1: shows date/time in the device format, topic, link/place and the status badge', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: all }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('MEETINGS (5)')).toBeTruthy();
    const f = inMeeting('F');
    expect(f.getByText(formatDateTime(future.startsAt))).toBeTruthy();
    expect(f.getByText('Future')).toBeTruthy();
    expect(f.getByText('Scheduled')).toBeTruthy();
    expect(inMeeting('C').getByText('Completed')).toBeTruthy();
    expect(inMeeting('X').getByText('Canceled')).toBeTruthy();
  });

  it('AC1: an http(s) location opens in the browser; a place is plain text', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    setStore(fakeStore('S1', { courseMembers: members, meetings: all }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(screen.getByRole('link', { name: 'https://meet.example/x' }));
    expect(open).toHaveBeenCalledWith('https://meet.example/x');
    expect(inMeeting('P').getByText('Room 12')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Room 12' })).toBeNull();
  });

  it('AC2: upcoming soonest first, then past (any status) newest first', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings: all }));
    await render(<CourseDetailScreen />);
    const order = screen.getAllByTestId(/^meeting-/).map((v) => v.props.testID);
    expect(order).toEqual(['meeting-S', 'meeting-F', 'meeting-P', 'meeting-X', 'meeting-C']);
  });

  it.each(['T', 'M', 'N'] as const)('AC1: %s (teacher, owner, unrelated mentor) sees the section', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: all }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('MEETINGS (5)')).toBeTruthy();
  });

  it('AC3: a student who is not a listener does not see the section', async () => {
    setStore(fakeStore('S2', { courseMembers: members, meetings: [] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByText(/^MEETINGS/)).toBeNull();
  });

  it('AC4: no meetings: empty text, plus "+ Schedule meeting" for the owner', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('No meetings scheduled yet')).toBeTruthy();
    await fireEvent.press(button('+ Schedule meeting'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/meetings/new', params: { id: 'A' } });
  });

  it('AC4: a listener sees the empty text without the button', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('No meetings scheduled yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Schedule meeting' })).toBeNull();
  });

  it('AC5: a meeting arriving from the (live-refetched) store is shown', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [] }));
    const view = await render(<CourseDetailScreen />);
    setStore(fakeStore('S1', { courseMembers: members, meetings: [future] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.getByText('Future')).toBeTruthy();
  });
});

describe('Who manages meetings', () => {
  it.each([
    ['M', 'A', 'mentor owner'],
    ['T', 'T1', 'teacher owner'],
    ['T', 'A', 'teacher on a mentor-owned course'],
  ] as const)('AC6/AC9/AC10: %s on %s (%s) sees schedule and status actions', async (who, courseId, _label) => {
    params.id = courseId;
    const list = [future, pastUnmarked, completed, canceled].map((m) => ({ ...m, courseId }));
    setStore(fakeStore(who, { courses: [courseA, courseT1], courseMembers: members, meetings: list }));
    await render(<CourseDetailScreen />);
    expect(button('+ Schedule meeting')).toBeTruthy();
    // AC 9: started and Scheduled → Mark completed / Mark canceled.
    expect(inMeeting('P').getByRole('button', { name: 'Mark completed' })).toBeTruthy();
    expect(inMeeting('P').getByRole('button', { name: 'Mark canceled' })).toBeTruthy();
    expect(inMeeting('P').queryByRole('button', { name: 'Cancel meeting' })).toBeNull();
    // AC 10: future → only Cancel meeting.
    expect(inMeeting('F').getByRole('button', { name: 'Cancel meeting' })).toBeTruthy();
    expect(inMeeting('F').queryByRole('button', { name: 'Mark completed' })).toBeNull();
    // AC 12: completed and canceled → no status actions. ARU-28 AC 3 adds "Add notes" to completed meetings.
    expect(inMeeting('C').queryAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Add notes']);
    expect(inMeeting('X').queryAllByRole('button')).toHaveLength(0);
  });

  it.each(['N', 'S1'] as const)('AC6: %s (mentor not owning it, student listener) has no actions', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: all }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: '+ Schedule meeting' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark|Cancel meeting/ })).toBeNull();
  });

  it('AC13: after the owner changes M → N, N manages and M does not', async () => {
    const moved = { ...courseA, createdById: 'N' };
    setStore(fakeStore('N', { courses: [moved], courseMembers: members, meetings: all }));
    const view = await render(<CourseDetailScreen />);
    expect(button('+ Schedule meeting')).toBeTruthy();
    expect(inMeeting('F').getByRole('button', { name: 'Cancel meeting' })).toBeTruthy();
    setStore(fakeStore('M', { courses: [moved], courseMembers: members, meetings: all }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: '+ Schedule meeting' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark|Cancel meeting/ })).toBeNull();
  });
});

describe('Setting the status', () => {
  // Answers the next native confirmation with the button labelled `choice`.
  const answer = (choice: string) =>
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.text === choice)?.onPress?.();
    });

  it('AC11: confirm "Mark <topic> on <date and time> as completed?" then save', async () => {
    const alert = answer('Mark completed');
    const setMeetingStatus = jest.fn(async () => {});
    setStore(fakeStore('M', { courseMembers: members, meetings: all, setMeetingStatus }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('P').getByRole('button', { name: 'Mark completed' }));
    expect(alert).toHaveBeenCalledWith(
      'Mark completed',
      `Mark Past on ${formatDateTime(pastUnmarked.startsAt)} as completed?`,
      expect.any(Array),
      expect.any(Object),
    );
    await waitFor(() => expect(setMeetingStatus).toHaveBeenCalledWith('P', 'completed'));
  });

  it('AC10/AC11: "Cancel meeting" asks "… as canceled?" and saves canceled', async () => {
    const alert = answer('Mark canceled');
    const setMeetingStatus = jest.fn(async () => {});
    setStore(fakeStore('T', { courseMembers: members, meetings: all, setMeetingStatus }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('F').getByRole('button', { name: 'Cancel meeting' }));
    expect(alert.mock.calls[0][1]).toBe(`Mark Future on ${formatDateTime(future.startsAt)} as canceled?`);
    await waitFor(() => expect(setMeetingStatus).toHaveBeenCalledWith('F', 'canceled'));
  });

  it('AC11: dismissing the confirmation changes nothing', async () => {
    answer('Not now');
    const setMeetingStatus = jest.fn(async () => {});
    setStore(fakeStore('M', { courseMembers: members, meetings: all, setMeetingStatus }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('P').getByRole('button', { name: 'Mark canceled' }));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(setMeetingStatus).not.toHaveBeenCalled();
  });

  it('edge: a database rejection is shown', async () => {
    answer('Mark completed');
    const setMeetingStatus = jest.fn(async () => {
      throw new Error('Only the course owner or the teacher can change a meeting\'s status.');
    });
    setStore(fakeStore('M', { courseMembers: members, meetings: all, setMeetingStatus }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(inMeeting('P').getByRole('button', { name: 'Mark completed' }));
    expect(await screen.findByText("Only the course owner or the teacher can change a meeting's status.")).toBeTruthy();
  });
});

describe('Schedule meeting screen', () => {
  it('AC7: schedules with the picked time, topic and link, then goes back', async () => {
    const addMeeting = jest.fn(async () => {});
    setStore(fakeStore('M', { courseMembers: members, addMeeting }));
    await render(<ScheduleMeetingScreen />);
    const when = new Date(Date.now() + 3 * 24 * HOUR);
    await fireEvent.changeText(screen.getByTestId('starts-at'), when.toISOString());
    await fireEvent.changeText(screen.getByPlaceholderText('Meeting'), 'Exam prep');
    await fireEvent.changeText(screen.getByPlaceholderText('https://… or Room 12'), 'https://meet.example/y');
    await fireEvent.press(button('Schedule'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(addMeeting).toHaveBeenCalledWith({
      id: expect.any(String),
      courseId: 'A',
      startsAt: when.toISOString(),
      topic: 'Exam prep',
      location: 'https://meet.example/y',
    });
  });

  it('AC7: the default start is in the future and Schedule is enabled', async () => {
    setStore(fakeStore('T', { courseMembers: members }));
    await render(<ScheduleMeetingScreen />);
    expect(new Date(screen.getByTestId('starts-at').props.value).getTime()).toBeGreaterThan(Date.now());
    expect(button('Schedule')).toBeEnabled();
    expect(screen.queryByText('Pick a time in the future')).toBeNull();
  });

  it('AC8: a past time disables Schedule with a hint', async () => {
    setStore(fakeStore('M', { courseMembers: members }));
    await render(<ScheduleMeetingScreen />);
    await fireEvent.changeText(screen.getByTestId('starts-at'), at(-1));
    expect(screen.getByText('Pick a time in the future')).toBeTruthy();
    expect(button('Schedule')).toBeDisabled();
  });

  it('edge: a rejection is shown, values are kept, and the retry reuses the same id', async () => {
    const addMeeting = jest
      .fn()
      .mockRejectedValueOnce(new Error('new row violates row-level security policy'))
      .mockResolvedValueOnce(undefined);
    setStore(fakeStore('M', { courseMembers: members, addMeeting }));
    await render(<ScheduleMeetingScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('Meeting'), 'Kept');
    await fireEvent.press(button('Schedule'));
    expect(await screen.findByText('new row violates row-level security policy')).toBeTruthy();
    expect(screen.getByDisplayValue('Kept')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(button('Schedule'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(addMeeting.mock.calls[1][0].id).toBe(addMeeting.mock.calls[0][0].id);
  });

  it.each(['N', 'S1'] as const)('AC6: %s opening the route is not allowed', async (who) => {
    setStore(fakeStore(who, { courseMembers: members }));
    await render(<ScheduleMeetingScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });
});

describe('helpers', () => {
  it('sortMeetings: future canceled meetings are not "upcoming"', () => {
    const futureCanceled = meeting({ id: 'FC', startsAt: at(5), status: 'canceled' });
    const { upcoming, past } = sortMeetings([futureCanceled, future]);
    expect(upcoming.map((m) => m.id)).toEqual(['F']);
    expect(past.map((m) => m.id)).toEqual(['FC']);
  });

  it('hasStarted and isLink', () => {
    expect(hasStarted({ startsAt: at(-1) })).toBe(true);
    expect(hasStarted({ startsAt: at(1) })).toBe(false);
    expect(isLink('https://a.b/c')).toBe(true);
    expect(isLink('HTTP://a.b')).toBe(true);
    expect(isLink('Room 12')).toBe(false);
    expect(isLink('see https://a.b')).toBe(false);
    expect(isLink(undefined)).toBe(false);
  });
});
