// QA ARU-98: gaps in the dev tests: for every role (student in no course, mentor who owns and attends, accountant,
// teacher) Profile shows no course card, course title, listener name, "Mentor:" line or empty-state text; a course
// added while Profile is open doesn't appear there; the bottom buttons keep their order (AC 5).
import { render, screen } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import type { User } from '@/lib/types';

import { courseA, courseB, fakeStore, member, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const gone = [/^MY COURSES$/i, /^COURSES I OWN$/i, /No mentor yet/, /You do not own any courses yet/, /^Mentor: /, /No listeners yet/];

beforeEach(() => jest.clearAllMocks());

const expectNoCourseContent = () => {
  for (const re of gone) expect(screen.queryByText(re)).toBeNull();
  expect(screen.queryByText(courseA.title)).toBeNull();
  expect(screen.queryByText(courseB.title)).toBeNull();
};

it('AC 2: a student in no course sees no course card and no "No mentor yet" hint', async () => {
  setStore(fakeStore('S2', { courses: [courseA, courseB], courseMembers: [] }));
  await render(<ProfileScreen />);
  expectNoCourseContent();
});

it('AC 1 / AC 3 / AC 4: a mentor who owns A (with listeners) and attends B sees neither card nor any listener name', async () => {
  setStore(
    fakeStore('M', {
      courses: [courseA, { ...courseB, createdById: 'N' }],
      courseMembers: [member('A', 'S1'), member('A', 'S2'), member('B', 'M')],
    }),
  );
  await render(<ProfileScreen />);
  expectNoCourseContent();
  expect(screen.queryByText(users.S1.name)).toBeNull();
  expect(screen.queryByText(users.S2.name)).toBeNull();
});

it('AC 4 / AC 5: an accountant mentor and the teacher see no course card; the Accountant section stays', async () => {
  const accountant: User = { ...users.M, isAccountant: true };
  setStore({ ...fakeStore('M', { courses: [courseA], courseMembers: [member('A', 'S1')] }), currentUser: accountant });
  const view = await render(<ProfileScreen />);
  expectNoCourseContent();
  expect(screen.getByText('ACCOUNTANT')).toBeTruthy();
  await view.unmount();
  setStore(fakeStore('T', { courses: [courseA], courseMembers: [member('A', 'S1')] }));
  await render(<ProfileScreen />);
  expectNoCourseContent();
  expect(screen.getByText('ACCOUNTANT')).toBeTruthy();
});

it('data: a course added while Profile is open never appears there', async () => {
  setStore(fakeStore('S1', { courses: [], courseMembers: [] }));
  const view = await render(<ProfileScreen />);
  setStore(fakeStore('S1', { courses: [courseA], courseMembers: [member('A', 'S1')] }));
  await view.rerender(<ProfileScreen />);
  expectNoCourseContent();
});

it('AC 5: the bottom buttons keep their order (student: Change password, Sign out, Delete account last)', async () => {
  setStore(fakeStore('S1', { courses: [courseA], courseMembers: [member('A', 'S1')] }));
  await render(<ProfileScreen />);
  const texts = ['Change password', 'Sign out', 'Delete account'].map((t) => screen.getByRole('button', { name: t }));
  const all = screen.getAllByRole('button');
  const idx = texts.map((b) => all.indexOf(b));
  expect(idx).toEqual([...idx].sort((x, y) => x - y));
  expect(idx[2]).toBe(all.length - 1);
});
