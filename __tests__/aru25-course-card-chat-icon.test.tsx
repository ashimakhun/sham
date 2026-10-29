// ARU-25: a chat icon on a course card (Courses tab) opens that course's chat, only for people in the chat
// (teacher, current owner, listeners — inCourseChat()). A is owned by M with S1 and M2 as listeners; B is owned by N.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import CoursesScreen from '@/app/(tabs)/courses';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { refocus, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courses = [courseB, courseA];
const members = [member('A', 'S1'), member('A', 'M2')];
const chatA = { name: 'Open chat for Algebra' };
const chatB = { name: 'Open chat for Biology' };
const showAll = () => fireEvent.press(screen.getByRole('tab', { name: 'All courses' }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AC1/AC2: who sees the icon', () => {
  it.each(['S1', 'M2', 'M'] as const)('%s sees the icon on A only, in My courses and All courses', async (who) => {
    setStore(fakeStore(who, { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    expect(screen.getByRole('button', chatA)).toBeTruthy();
    expect(screen.queryByRole('button', chatB)).toBeNull();
    await showAll();
    expect(screen.getByRole('button', chatA)).toBeTruthy();
    expect(screen.queryByRole('button', chatB)).toBeNull();
  });

  it('the teacher sees the icon on every course', async () => {
    setStore(fakeStore('T', { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    await showAll();
    expect(screen.getByRole('button', chatA)).toBeTruthy();
    expect(screen.getByRole('button', chatB)).toBeTruthy();
  });

  it.each(['S2', 'N'] as const)('%s (not in A) sees no icon on A', async (who) => {
    setStore(fakeStore(who, { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    await showAll();
    expect(screen.getByText('Algebra')).toBeTruthy();
    expect(screen.queryByRole('button', chatA)).toBeNull();
  });
});

describe('AC3/AC4/AC5: taps', () => {
  it('the icon opens the chat, not the details, and back keeps All courses', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    await showAll();
    await fireEvent.press(screen.getByRole('button', chatA));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/chat', params: { id: 'A' } });
    await refocus();
    expect(screen.getByRole('tab', { name: 'All courses', selected: true })).toBeTruthy();
  });

  it('a quick double tap on the icon opens only one chat', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    await fireEvent.press(screen.getByRole('button', chatA));
    await fireEvent.press(screen.getByRole('button', chatA));
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('the rest of the card still opens the details', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    await fireEvent.press(screen.getByText('Algebra'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });
});

describe('AC6: live access changes', () => {
  it('removing the listener hides the icon', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    const view = await render(<CoursesScreen />);
    await showAll();
    expect(screen.getByRole('button', chatA)).toBeTruthy();
    setStore(fakeStore('S1', { courses, courseMembers: [member('A', 'M2')] }));
    await view.rerender(<CoursesScreen />);
    expect(screen.getByText('Algebra')).toBeTruthy();
    expect(screen.queryByRole('button', chatA)).toBeNull();
  });

  it('ownership moving away hides the owner icon', async () => {
    setStore(fakeStore('M', { courses, courseMembers: members }));
    const view = await render(<CoursesScreen />);
    await showAll();
    expect(screen.getByRole('button', chatA)).toBeTruthy();
    setStore(fakeStore('M', { courses: [courseB, { ...courseA, createdById: 'M2' }], courseMembers: [member('A', 'S1')] }));
    await view.rerender(<CoursesScreen />);
    expect(screen.queryByRole('button', chatA)).toBeNull();
  });
});
