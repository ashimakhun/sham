// ARU-19: "+ Add homework" only for students who are a listener of at least one (loaded) course.
// Mentors and the teacher keep the ARU-14 rules. No database change (RLS already blocks other courses).
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import NewHomeworkScreen from '@/app/homework/new';
import { router } from 'expo-router';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const ADD = '+ Add homework';
const NO_COURSE_HINT = 'You are not in any course yet — ask your teacher or mentor to add you.';
const IN_COURSE_HINT = 'Tap "Add homework" to send your work to your course mentor.';
const addButton = () => screen.queryByRole('button', { name: ADD });

beforeEach(() => jest.clearAllMocks());

it('AC1/AC3: a student in no course sees no button and the "not in any course" hint', async () => {
  setStore(fakeStore('S2', { courseMembers: [member('A', 'S1')] }));
  await render(<HomeworkScreen />);
  expect(addButton()).toBeNull();
  expect(screen.getByText('No homework yet')).toBeTruthy();
  expect(screen.getByText(NO_COURSE_HINT)).toBeTruthy();
  expect(screen.queryByText(/Add homework/)).toBeNull();
});

it.each([
  ['one course', [member('A', 'S1')]],
  ['two courses', [member('A', 'S1'), member('B', 'S1')]],
])('AC2/AC4: a student in %s sees the button (opens the form) and the unchanged hint', async (_label, members) => {
  setStore(fakeStore('S1', { courseMembers: members }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByRole('button', { name: ADD }));
  expect(router.push).toHaveBeenCalledWith('/homework/new');
  expect(screen.getByText(IN_COURSE_HINT)).toBeTruthy();
});

it('edge: a membership of a course that is not loaded does not count', async () => {
  setStore(fakeStore('S1', { courses: [courseB], courseMembers: [member('A', 'S1')] }));
  await render(<HomeworkScreen />);
  expect(addButton()).toBeNull();
  expect(screen.getByText(NO_COURSE_HINT)).toBeTruthy();
});

it('AC5: being added to a course (live refetch) shows the button without reopening', async () => {
  setStore(fakeStore('S2', { courseMembers: [] }));
  const view = await render(<HomeworkScreen />);
  expect(addButton()).toBeNull();
  setStore(fakeStore('S2', { courseMembers: [member('A', 'S2')] }));
  await view.rerender(<HomeworkScreen />);
  expect(addButton()).toBeTruthy();
  expect(screen.getByText(IN_COURSE_HINT)).toBeTruthy();
});

it('AC6/AC7: removed from the last course → no button; earlier homework and filters stay', async () => {
  const earlier = [hw({ id: 'h1', courseId: 'A', studentId: 'S1', title: 'Sent before removal' })];
  setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], visibleHomework: earlier }));
  const view = await render(<HomeworkScreen />);
  expect(addButton()).toBeTruthy();
  setStore(fakeStore('S1', { courseMembers: [], visibleHomework: earlier }));
  await view.rerender(<HomeworkScreen />);
  expect(addButton()).toBeNull();
  expect(screen.getByText('Sent before removal')).toBeTruthy();
  expect(screen.getByText('All')).toBeTruthy();
});

it('AC6: removed from one of two courses → the button stays', async () => {
  setStore(fakeStore('S1', { courseMembers: [member('A', 'S1'), member('B', 'S1')] }));
  const view = await render(<HomeworkScreen />);
  setStore(fakeStore('S1', { courseMembers: [member('B', 'S1')] }));
  await view.rerender(<HomeworkScreen />);
  expect(addButton()).toBeTruthy();
});

describe('AC8: mentors and the teacher unchanged', () => {
  // Changed by ARU-23: the mentor's button is on the Listener tab.
  it('a mentor listener gets the button on the Listener tab', async () => {
    setStore(fakeStore('M2', { courseMembers: [member('A', 'M2')] }));
    await render(<HomeworkScreen />);
    expect(addButton()).toBeNull(); // Owner tab
    await fireEvent.press(screen.getByRole('tab', { name: 'Listener' }));
    expect(addButton()).toBeTruthy();
  });

  it('a mentor in no course gets neither', async () => {
    setStore(fakeStore('M2', { courseMembers: [] }));
    await render(<HomeworkScreen />);
    expect(addButton()).toBeNull();
    expect(screen.queryByText('My homework')).toBeNull();
  });

  it('the teacher never gets the button', async () => {
    setStore(fakeStore('T', { courses: [courseA], courseMembers: [member('A', 'S1')] }));
    await render(<HomeworkScreen />);
    expect(addButton()).toBeNull();
  });
});

it('AC9: opening the form directly with no course still explains and cannot send', async () => {
  setStore(fakeStore('S2', { courseMembers: [] }));
  await render(<NewHomeworkScreen />);
  expect(screen.getByText('You are not in any course yet — ask your teacher or mentor to add you')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();
});
