// ARU-15 QA additions to aru15-edit-meeting.test.tsx, with the real DateTimeField (the dev tests replace it with
// a text box): on Android, re-picking the same date and time of a past, unmarked meeting is not a reschedule, and
// picking a new future time is. Rules: supabase/tests/aru15_edit_meetings*.test.sql.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import EditMeetingScreen from '@/app/courses/[id]/meetings/[meetingId]';
import type { Meeting } from '@/lib/types';
import { router } from 'expo-router';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props: object) => <View {...props} />, DateTimePickerAndroid: { open: jest.fn() } };
});

const { DateTimePickerAndroid } = jest.requireMock('@react-native-community/datetimepicker') as {
  DateTimePickerAndroid: { open: jest.Mock };
};
const originalOS = Platform.OS;
const setOS = (os: typeof Platform.OS) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

// A past, unmarked meeting at a whole minute, as the app schedules them (two hours ago, rounded to the minute).
const start = new Date(Date.now() - 2 * 3600_000);
start.setSeconds(0, 0);
const P: Meeting = {
  id: 'P',
  courseId: 'A',
  startsAt: start.toISOString().replace('.000Z', '+00:00'), // as the database returns it
  topic: 'Past',
  location: 'Room 12',
  status: 'scheduled',
  createdById: 'M',
  createdAt: start.toISOString(),
};

const lastDialog = () => DateTimePickerAndroid.open.mock.calls.at(-1)[0];
// Answers the open native dialog (state updates from a native callback need act()).
const answer = (value: Date) =>
  act(async () => {
    lastDialog().onValueChange({ type: 'set' }, value);
  });

beforeEach(() => {
  jest.clearAllMocks();
  setOS('android');
  params.id = 'A';
  (params as { meetingId?: string }).meetingId = 'P';
});
afterEach(() => setOS(originalOS));

it('AC3: re-picking the same date and time of a past meeting is not a reschedule; Save sends the original start', async () => {
  const updateMeeting = jest.fn(async () => {});
  setStore(fakeStore('M', { courseMembers: [member('A', 'S1')], meetings: [P], updateMeeting }));
  await render(<EditMeetingScreen />);

  await fireEvent.press(screen.getByRole('button', { name: 'Pick date' }));
  await answer(new Date(start.getFullYear(), start.getMonth(), start.getDate()));
  await answer(new Date(2000, 0, 1, start.getHours(), start.getMinutes()));

  expect(screen.queryByText('Pick a time in the future')).toBeNull();
  await fireEvent.changeText(screen.getByDisplayValue('Past'), 'Past, fixed');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
  expect(updateMeeting).toHaveBeenCalledWith('P', { startsAt: P.startsAt, topic: 'Past, fixed', location: 'Room 12' });
});

it('AC2/AC3: picking a new future date through the dialogs reschedules to that minute', async () => {
  const updateMeeting = jest.fn(async () => {});
  setStore(fakeStore('T', { courseMembers: [member('A', 'S1')], meetings: [P], updateMeeting }));
  await render(<EditMeetingScreen />);

  await fireEvent.press(screen.getByRole('button', { name: 'Pick date' }));
  await answer(new Date(2030, 0, 15));
  await answer(new Date(2000, 0, 1, 16, 30));

  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(updateMeeting).toHaveBeenCalled());
  expect(updateMeeting).toHaveBeenCalledWith('P', expect.objectContaining({ startsAt: new Date(2030, 0, 15, 16, 30).toISOString() }));
});

it('AC3: picking an earlier time today through the time dialog disables Save with the hint', async () => {
  setStore(fakeStore('M', { courseMembers: [member('A', 'S1')], meetings: [P] }));
  await render(<EditMeetingScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Pick time' }));
  const earlier = new Date(start.getTime() - 3600_000);
  await answer(earlier);
  expect(screen.getByText('Pick a time in the future')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});
