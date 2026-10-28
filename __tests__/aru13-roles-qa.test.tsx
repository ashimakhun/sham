// ARU-13 QA additions (revised TEST DESIGN): AC 5 with several owned courses, AC 3 for a student who is a
// course listener, and the search box with mixed case. DB side: supabase/tests/aru13_roles_qa.test.sql.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import RolesScreen from '@/app/roles';
import { confirmDestructive } from '@/lib/confirm';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/lib/confirm', () => ({ confirmDestructive: jest.fn() }));

const confirm = confirmDestructive as jest.Mock;
const row = (id: string) => screen.getByTestId(`user-${id}`);

beforeEach(() => jest.clearAllMocks());

it('AC5: a mentor owning several courses is refused with the count and the titles sorted', async () => {
  const setUserRole = jest.fn(async () => {});
  const courses = [courseB, courseA, { ...courseA, id: 'Z', title: 'Zoology', createdById: 'N' }];
  setStore(fakeStore('T', { courses, setUserRole }));
  await render(<RolesScreen />);
  await fireEvent.press(within(row('N')).getByRole('button', { name: 'Make student' }));
  expect(await screen.findByText('Mentor Nina owns 2 course(s): Biology, Zoology. Reassign them first')).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
  expect(setUserRole).not.toHaveBeenCalled();
});

it('AC3/AC7: a student who is a course listener is promoted the same way (memberships are not touched)', async () => {
  confirm.mockResolvedValue(true);
  const setUserRole = jest.fn(async () => {});
  const store = fakeStore('T', { courseMembers: [member('A', 'S1')], setUserRole });
  setStore(store);
  await render(<RolesScreen />);
  await fireEvent.press(within(row('S1')).getByRole('button', { name: 'Make mentor' }));
  await waitFor(() => expect(setUserRole).toHaveBeenCalledWith('S1', 'mentor'));
  expect(confirm).toHaveBeenCalledWith(
    'Make mentor',
    "Make Student Sam a mentor? They will be able to see and check all students' homework and photos in every course.",
    'Make mentor',
  );
  expect(store.removeListener).not.toHaveBeenCalled();
});

it('AC2: search with mixed case and a middle substring keeps sections in order', async () => {
  setStore(fakeStore('T'));
  await render(<RolesScreen />);
  await fireEvent.changeText(screen.getByLabelText('Search users'), 'TUDEN');
  const shown = screen.queryAllByTestId(/^user-/).map((r) => r.props.testID.slice(5));
  expect(shown).toEqual(['S3', 'S1', 'S2']);
  expect(screen.queryByText('MENTORS')).toBeNull();
  expect(screen.queryByText('TEACHER')).toBeNull();
});
