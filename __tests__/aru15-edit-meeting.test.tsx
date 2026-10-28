// ARU-15: edit and reschedule a Scheduled meeting (UI side). Rules: supabase/tests/aru15_edit_meetings.test.sql.
// Course A owned by mentor M, course T1 owned by teacher T; N a mentor with no link; S1 a student listener of A.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import EditMeetingScreen from '@/app/courses/[id]/meetings/[meetingId]';
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

// The database returns timestamps in its own format; an untouched time must be sent back exactly like this.
const F = meeting({ id: 'F', topic: 'Future', location: 'https://meet.example/x', startsAt: '2099-01-02T10:00:00.123456+00:00' });
const P = meeting({ id: 'P', topic: 'Past', startsAt: at(-2), location: 'Room 12' });
const C = meeting({ id: 'C', topic: 'Done', startsAt: at(-30), status: 'completed' });
const X = meeting({ id: 'X', topic: 'Dropped', startsAt: at(-5), status: 'canceled' });
const all = [F, P, C, X];

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
});

describe('Edit action', () => {
  it.each([
    ['M', 'A', 'mentor owner'],
    ['T', 'T1', 'teacher owner'],
    ['T', 'A', 'teacher on a mentor-owned course'],
  ] as const)('AC1/AC6: %s on %s (%s) sees Edit on scheduled meetings only', async (who, courseId, _label) => {
    params.id = courseId;
    const list = all.map((m) => ({ ...m, courseId }));
    setStore(fakeStore(who, { courses: [courseA, courseT1], courseMembers: members, meetings: list }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('F').getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(inMeeting('P').getByRole('button', { name: 'Edit' })).toBeTruthy(); // past but not yet marked
    expect(inMeeting('C').queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(inMeeting('X').queryByRole('button', { name: 'Edit' })).toBeNull();
    await fireEvent.press(inMeeting('F').getByRole('button', { name: 'Edit' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]',
      params: { id: courseId, meetingId: 'F' },
    });
  });

  it.each(['N', 'S1'] as const)('AC1: %s (mentor not owning it, student listener) sees no Edit', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: all }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('AC5: "Rescheduled" shows only on meetings whose time was changed', async () => {
    const moved = { ...F, rescheduledAt: at(-1) };
    setStore(fakeStore('S1', { courseMembers: members, meetings: [moved, P] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('F').getByText('Rescheduled')).toBeTruthy();
    expect(inMeeting('P').queryByText('Rescheduled')).toBeNull();
  });

  it('AC2: an edited time from the (live-refetched) store moves the meeting in the list', async () => {
    const later = meeting({ id: 'L', startsAt: at(48) });
    setStore(fakeStore('S1', { courseMembers: members, meetings: [later, { ...P, startsAt: at(-2) }] }));
    const view = await render(<CourseDetailScreen />);
    expect(screen.getAllByTestId(/^meeting-/).map((v) => v.props.testID)).toEqual(['meeting-L', 'meeting-P']);
    setStore(fakeStore('S1', { courseMembers: members, meetings: [later, { ...P, startsAt: at(5), rescheduledAt: at(0) }] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.getAllByTestId(/^meeting-/).map((v) => v.props.testID)).toEqual(['meeting-P', 'meeting-L']);
  });
});

describe('Edit meeting screen', () => {
  const open = (who: 'M' | 'T' | 'N' | 'S1', meetingId: string, over = {}) => {
    params.meetingId = meetingId;
    const updateMeeting = jest.fn(async () => {});
    setStore(fakeStore(who, { courseMembers: members, meetings: all, updateMeeting, ...over }));
    return updateMeeting;
  };

  it('AC2: pre-filled with the meeting; topic/link change saves with the exact original time, then goes back', async () => {
    const updateMeeting = open('M', 'F');
    await render(<EditMeetingScreen />);
    expect(new Date(screen.getByTestId('starts-at').props.value).getTime()).toBe(new Date(F.startsAt).getTime());
    expect(screen.getByDisplayValue('Future')).toBeTruthy();
    expect(screen.getByDisplayValue('https://meet.example/x')).toBeTruthy();
    await fireEvent.changeText(screen.getByDisplayValue('Future'), 'Exam prep');
    await fireEvent.press(button('Save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(updateMeeting).toHaveBeenCalledWith('F', {
      startsAt: '2099-01-02T10:00:00.123456+00:00',
      topic: 'Exam prep',
      location: 'https://meet.example/x',
    });
  });

  it('AC2/AC3: a new future time is sent as an ISO timestamp', async () => {
    const updateMeeting = open('T', 'F');
    await render(<EditMeetingScreen />);
    const when = new Date(Date.now() + 72 * HOUR);
    await fireEvent.changeText(screen.getByTestId('starts-at'), when.toISOString());
    await fireEvent.press(button('Save'));
    await waitFor(() => expect(updateMeeting).toHaveBeenCalled());
    expect(updateMeeting).toHaveBeenCalledWith('F', expect.objectContaining({ startsAt: when.toISOString() }));
  });

  it('AC3: changing the time to the past disables Save with a hint', async () => {
    open('M', 'F');
    await render(<EditMeetingScreen />);
    await fireEvent.changeText(screen.getByTestId('starts-at'), at(-1));
    expect(screen.getByText('Pick a time in the future')).toBeTruthy();
    expect(button('Save')).toBeDisabled();
  });

  it('AC3: a past, unmarked meeting keeps Save enabled for a topic-only edit', async () => {
    const updateMeeting = open('M', 'P');
    await render(<EditMeetingScreen />);
    expect(screen.queryByText('Pick a time in the future')).toBeNull();
    expect(button('Save')).toBeEnabled();
    await fireEvent.changeText(screen.getByDisplayValue('Past'), 'Past fixed');
    await fireEvent.press(button('Save'));
    await waitFor(() => expect(updateMeeting).toHaveBeenCalledWith('P', { startsAt: P.startsAt, topic: 'Past fixed', location: 'Room 12' }));
  });

  it('AC3: moving a past meeting to another past time disables Save', async () => {
    open('M', 'P');
    await render(<EditMeetingScreen />);
    await fireEvent.changeText(screen.getByTestId('starts-at'), at(-10));
    expect(button('Save')).toBeDisabled();
  });

  it('AC4: cleared topic and link are sent empty (the database stores "Meeting" and no link)', async () => {
    const updateMeeting = open('M', 'F');
    await render(<EditMeetingScreen />);
    await fireEvent.changeText(screen.getByDisplayValue('Future'), '');
    await fireEvent.changeText(screen.getByDisplayValue('https://meet.example/x'), '');
    await fireEvent.press(button('Save'));
    await waitFor(() => expect(updateMeeting).toHaveBeenCalledWith('F', expect.objectContaining({ topic: '', location: '' })));
  });

  it('edge: a rejection (e.g. canceled meanwhile) is shown, values kept, no crash', async () => {
    open('M', 'F', {
      updateMeeting: jest.fn(async () => {
        throw new Error("This meeting is already canceled; it can't be edited.");
      }),
    });
    await render(<EditMeetingScreen />);
    await fireEvent.changeText(screen.getByDisplayValue('Future'), 'Kept');
    await fireEvent.press(button('Save'));
    expect(await screen.findByText("This meeting is already canceled; it can't be edited.")).toBeTruthy();
    expect(screen.getByDisplayValue('Kept')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it.each(['C', 'X'])('AC6: %s (completed/canceled) cannot be opened for editing', async (id) => {
    open('M', id);
    await render(<EditMeetingScreen />);
    expect(screen.getByText("Can't edit this meeting")).toBeTruthy();
  });

  it.each(['N', 'S1'] as const)('AC1: %s opening the route is not allowed', async (who) => {
    open(who, 'F');
    await render(<EditMeetingScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });

  it('edge: an unknown meeting', async () => {
    open('M', 'nope');
    await render(<EditMeetingScreen />);
    expect(screen.getByText('Meeting not found')).toBeTruthy();
  });
});
