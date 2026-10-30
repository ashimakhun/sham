// ARU-19 QA additions to aru19-hide-add-homework.test.tsx, from the TEST DESIGN: no button flash before the
// first load, filters for a no-course student with earlier homework (AC 7), the deep-linked form for a mentor in
// no course (AC 9), and "+ Add homework" never appearing for the teacher even as a course owner (AC 8).
// Changed by ARU-32: there is no top "+ Add homework" for anyone (homework is sent from a New card), students get
// New / Waiting / Checked without "All", and the form needs an assignment. What stays from ARU-19: no way to send
// without a course, and the "not in any course" hint that never mentions "Add homework".
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import NewHomeworkScreen from '@/app/homework/new';

import { courseA, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const addButton = () => screen.queryByRole('button', { name: '+ Add homework' });

beforeEach(() => jest.clearAllMocks());

it('edge: before and after the first load a student never gets a top button; New explains where homework comes from', async () => {
  setStore(fakeStore('S1', { courses: [], courseMembers: [], dataLoaded: false, loading: true }));
  const view = await render(<HomeworkScreen />);
  expect(addButton()).toBeNull();
  // Data arrives: the student turns out to be in course A.
  setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')] }));
  await view.rerender(<HomeworkScreen />);
  expect(addButton()).toBeNull();
  expect(screen.getByText('Homework your mentor assigns after a meeting will appear here.')).toBeTruthy();
});

it('AC7: a no-course student with earlier homework keeps it under Waiting / Checked; New shows the no-course hint', async () => {
  const earlier = [
    hw({ id: 'h1', courseId: 'A', studentId: 'S1', title: 'Waiting one' }),
    hw({ id: 'h2', courseId: 'A', studentId: 'S1', title: 'Checked one', status: 'checked' }),
  ];
  setStore(fakeStore('S1', { courseMembers: [], visibleHomework: earlier }));
  await render(<HomeworkScreen />);
  expect(addButton()).toBeNull();
  expect(screen.getByText('You are not in any course yet — ask your teacher or mentor to add you.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Waiting (1)'));
  expect(screen.getByText('Waiting one')).toBeTruthy();
  expect(screen.queryByText('Checked one')).toBeNull();
  await fireEvent.press(screen.getAllByText('Checked')[0]); // the filter, above the status badges
  expect(screen.queryByText('Waiting one')).toBeNull();
  expect(screen.getByText('Checked one')).toBeTruthy();
});

it('AC3: the no-course hint never mentions "Add homework", on any filter', async () => {
  setStore(fakeStore('S2', { courseMembers: [] }));
  await render(<HomeworkScreen />);
  expect(screen.queryByText(/Add homework/)).toBeNull();
  await fireEvent.press(screen.getByText('Waiting (0)'));
  expect(screen.queryByText(/Add homework/)).toBeNull();
  await fireEvent.press(screen.getAllByText('Checked')[0]); // the filter, above the status badges
  expect(screen.queryByText(/Add homework/)).toBeNull();
  expect(screen.getByText('You are not in any course yet — ask your teacher or mentor to add you.')).toBeTruthy();
});

// Changed by ARU-32: the form needs an assignment of a course the user attends.
it('AC9: a mentor in no course opening the form directly (even with an assignment id) cannot send', async () => {
  params.assignmentId = 'asgA';
  setStore(
    fakeStore('M2', {
      courseMembers: [],
      assignments: [
        { id: 'asgA', meetingId: 'mA', courseId: 'A', title: 'Exercises', description: '', createdById: 'M', createdAt: '2026-10-20T10:00:00.000Z' },
      ],
    }),
  );
  await render(<NewHomeworkScreen />);
  expect(screen.getByText('Open a homework assignment from New to send homework.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
  params.assignmentId = undefined;
});

it('AC8: the teacher never gets the button, even as the owner of a course with listeners', async () => {
  setStore(
    fakeStore('T', { courses: [{ ...courseA, createdById: 'T' }], courseMembers: [member('A', 'S1'), member('A', 'M2')] }),
  );
  await render(<HomeworkScreen />);
  expect(addButton()).toBeNull();
});
