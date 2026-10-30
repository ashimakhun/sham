// ARU-19: "+ Add homework" only for students who are a listener of at least one (loaded) course.
// Changed by ARU-32: the top "+ Add homework" button is gone for everyone; homework is sent from a card in New. What
// stays from ARU-19: a student in no course sees the "not in any course" hint, and the form can't be used without a
// course (now: without an assignment of a course they attend).
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import NewHomeworkScreen from '@/app/homework/new';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const ADD = '+ Add homework';
const NO_COURSE_HINT = 'You are not in any course yet — ask your teacher or mentor to add you.';
const NEW_HINT = 'Homework your mentor assigns after a meeting will appear here.';
const addButton = () => screen.queryByRole('button', { name: ADD });

beforeEach(() => jest.clearAllMocks());

it('AC1/AC3: a student in no course sees no button and the "not in any course" hint', async () => {
  setStore(fakeStore('S2', { courseMembers: [member('A', 'S1')] }));
  await render(<HomeworkScreen />);
  expect(addButton()).toBeNull();
  expect(screen.getByText(NO_COURSE_HINT)).toBeTruthy();
});

it.each([
  ['one course', [member('A', 'S1')]],
  ['two courses', [member('A', 'S1'), member('B', 'S1')]],
])('ARU-32: a student in %s has no top button; New explains where homework comes from', async (_label, members) => {
  setStore(fakeStore('S1', { courseMembers: members }));
  await render(<HomeworkScreen />);
  expect(addButton()).toBeNull();
  expect(screen.getByText(NEW_HINT)).toBeTruthy();
});

it('edge: a membership of a course that is not loaded does not count', async () => {
  setStore(fakeStore('S1', { courses: [courseB], courseMembers: [member('A', 'S1')] }));
  await render(<HomeworkScreen />);
  expect(screen.getByText(NO_COURSE_HINT)).toBeTruthy();
});

it('AC5: being added to a course (live refetch) replaces the no-course hint', async () => {
  setStore(fakeStore('S2', { courseMembers: [] }));
  const view = await render(<HomeworkScreen />);
  expect(screen.getByText(NO_COURSE_HINT)).toBeTruthy();
  setStore(fakeStore('S2', { courseMembers: [member('A', 'S2')] }));
  await view.rerender(<HomeworkScreen />);
  expect(screen.getByText(NEW_HINT)).toBeTruthy();
});

it('AC7: removed from the last course → earlier homework and filters stay', async () => {
  const earlier = [hw({ id: 'h1', courseId: 'A', studentId: 'S1', title: 'Sent before removal' })];
  setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], visibleHomework: earlier }));
  const view = await render(<HomeworkScreen />);
  setStore(fakeStore('S1', { courseMembers: [], visibleHomework: earlier }));
  await view.rerender(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Waiting (1)'));
  expect(screen.getByText('Sent before removal')).toBeTruthy();
});

describe('AC8: mentors and the teacher', () => {
  it('a mentor listener has no top button on either tab', async () => {
    setStore(fakeStore('M2', { courseMembers: [member('A', 'M2')] }));
    await render(<HomeworkScreen />);
    expect(addButton()).toBeNull(); // Owner tab
    await fireEvent.press(screen.getByRole('tab', { name: 'Listener' }));
    expect(addButton()).toBeNull();
  });

  it('the teacher never gets the button', async () => {
    setStore(fakeStore('T', { courses: [courseA], courseMembers: [member('A', 'S1')] }));
    await render(<HomeworkScreen />);
    expect(addButton()).toBeNull();
  });
});

it('AC9: opening the form directly without an assignment explains and cannot send', async () => {
  params.assignmentId = undefined;
  setStore(fakeStore('S2', { courseMembers: [] }));
  await render(<NewHomeworkScreen />);
  expect(screen.getByText('Open a homework assignment from New to send homework.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
});
