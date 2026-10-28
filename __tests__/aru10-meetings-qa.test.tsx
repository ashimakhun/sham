// ARU-10 QA additions to aru10-meetings.test.tsx: the real DateTimeField (the dev tests replace it with a text
// box) on Android (date dialog, then time dialog) and iOS (one compact picker), and the teacher-owned course as
// seen by a mentor. Rules are tested in supabase/tests/aru10_course_meetings*.test.sql.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { DateTimeField } from '@/components/DateTimeField';
import type { Course, Meeting } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  const Picker = (props: object) => <View testID="native-picker" {...props} />;
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn() } };
});

const { DateTimePickerAndroid } = jest.requireMock('@react-native-community/datetimepicker') as {
  DateTimePickerAndroid: { open: jest.Mock };
};
const originalOS = Platform.OS;
const setOS = (os: typeof Platform.OS) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

beforeEach(() => jest.clearAllMocks());
afterEach(() => setOS(originalOS));

describe('DateTimeField on Android: a date dialog, then a time dialog', () => {
  const start = new Date(2030, 4, 10, 9, 30); // 10 May 2030, 09:30 local

  it('AC7: picking a date keeps the time, then opens the time dialog for that date', async () => {
    setOS('android');
    const onChange = jest.fn();
    await render(<DateTimeField label="Date and start time" value={start} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pick date' }));

    const dateDialog = DateTimePickerAndroid.open.mock.calls.at(-1)[0];
    expect(dateDialog.mode).toBe('date');
    dateDialog.onValueChange({ type: 'set' }, new Date(2030, 5, 2, 0, 0));
    expect(onChange).toHaveBeenLastCalledWith(new Date(2030, 5, 2, 9, 30));

    const timeDialog = DateTimePickerAndroid.open.mock.calls.at(-1)[0];
    expect(timeDialog.mode).toBe('time');
    expect(timeDialog.value).toEqual(new Date(2030, 5, 2, 9, 30));
    timeDialog.onValueChange({ type: 'set' }, new Date(1999, 0, 1, 17, 45));
    expect(onChange).toHaveBeenLastCalledWith(new Date(2030, 5, 2, 17, 45));
  });

  it('AC7: the time button opens only the time dialog and keeps the date', async () => {
    setOS('android');
    const onChange = jest.fn();
    await render(<DateTimeField label="Date and start time" value={start} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pick time' }));
    expect(DateTimePickerAndroid.open).toHaveBeenCalledTimes(1);
    const timeDialog = DateTimePickerAndroid.open.mock.calls[0][0];
    expect(timeDialog.mode).toBe('time');
    timeDialog.onValueChange({ type: 'set' }, new Date(1999, 0, 1, 8, 5));
    expect(onChange).toHaveBeenLastCalledWith(new Date(2030, 4, 10, 8, 5));
    expect(screen.queryByTestId('native-picker')).toBeNull();
  });
});

describe('DateTimeField on iOS: one compact picker', () => {
  it('AC7: date and time come from one picker and are passed through', async () => {
    setOS('ios');
    const onChange = jest.fn();
    await render(<DateTimeField label="Date and start time" value={new Date(2030, 4, 10, 9, 30)} onChange={onChange} />);
    const picker = screen.getByTestId('native-picker');
    expect(picker.props.mode).toBe('datetime');
    expect(picker.props.display).toBe('compact');
    picker.props.onValueChange({ type: 'set' }, new Date(2030, 6, 1, 18, 0));
    expect(onChange).toHaveBeenCalledWith(new Date(2030, 6, 1, 18, 0));
    expect(DateTimePickerAndroid.open).not.toHaveBeenCalled();
  });
});

describe('Teacher-owned course', () => {
  const courseT1: Course = { id: 'T1', title: 'Teaching', description: '', createdById: 'T', createdAt: courseA.createdAt };
  const past: Meeting = {
    id: 'P',
    courseId: 'T1',
    startsAt: new Date(Date.now() - 3600_000).toISOString(),
    topic: 'Teacher past',
    status: 'scheduled',
    createdById: 'T',
    createdAt: courseA.createdAt,
  };

  it.each(['M', 'N'] as const)('AC1/AC6: mentor %s (N is a listener) sees the meetings but has no actions', async (who) => {
    params.id = 'T1';
    setStore(fakeStore(who, { courses: [courseA, courseT1], courseMembers: [member('T1', 'N')], meetings: [past] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Teacher past')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Schedule meeting' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark|Cancel meeting/ })).toBeNull();
  });

  it('AC3: a student listener of another course does not see the section', async () => {
    params.id = 'T1';
    setStore(fakeStore('S1', { courses: [courseA, courseT1], courseMembers: [member('A', 'S1')], meetings: [past] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByText(/MEETINGS/)).toBeNull();
    expect(screen.queryByText('Teacher past')).toBeNull();
  });
});
