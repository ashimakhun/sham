// ARU-13: the teacher switches users between student and mentor (UI side).
// The rules themselves are tested against the database in supabase/tests/aru13_roles.test.sql.
// Users: T teacher; M (owns A), N (owns B), M2 mentors; S1, S2, S3 ("Abby Student") students.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import RolesScreen from '@/app/roles';
import { confirmDestructive } from '@/lib/confirm';
import { router } from 'expo-router';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/lib/confirm', () => ({ confirmDestructive: jest.fn() }));

const confirm = confirmDestructive as jest.Mock;
const row = (id: string) => screen.getByTestId(`user-${id}`);
const shownNames = () => screen.queryAllByTestId(/^user-/).map((r) => r.props.testID.slice(5));
const headings = () => screen.queryAllByText(/^(TEACHER|MENTORS|STUDENTS)$/).map((h) => h.props.children);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Manage roles button', () => {
  it('AC1: the teacher sees it on Profile and it opens the Roles screen', async () => {
    setStore(fakeStore('T'));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Manage roles' }));
    expect(router.push).toHaveBeenCalledWith('/roles');
  });

  it.each(['M', 'S1'] as const)('AC1: %s does not see it', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    expect(screen.queryByRole('button', { name: 'Manage roles' })).toBeNull();
  });

  it.each(['M', 'S1'] as const)('AC1: %s opening the route directly is told only the teacher can', async (who) => {
    setStore(fakeStore(who));
    await render(<RolesScreen />);
    expect(screen.getByText('Only the teacher can manage roles')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Make/ })).toBeNull();
  });

  it('AC1 / analysis note 4: while the store loads, no denial is shown', async () => {
    setStore(fakeStore(null, { dataLoaded: false }));
    await render(<RolesScreen />);
    expect(screen.queryByText('Only the teacher can manage roles')).toBeNull();
  });
});

describe('Roles list', () => {
  it('AC2: three sections, each sorted by name, with role badges', async () => {
    setStore(fakeStore('T'));
    await render(<RolesScreen />);
    expect(headings()).toEqual(['TEACHER', 'MENTORS', 'STUDENTS']);
    expect(shownNames()).toEqual(['T', 'M', 'M2', 'N', 'S3', 'S1', 'S2']); // Max, Mo, Nina; Abby, Sam, Sue
    expect(within(row('M2')).getByText('Mentor')).toBeTruthy();
    expect(within(row('S1')).getByText('Student')).toBeTruthy();
  });

  it('AC2: search ignores case, matches any part of the name and hides empty sections', async () => {
    setStore(fakeStore('T'));
    await render(<RolesScreen />);
    const search = screen.getByLabelText('Search users');
    await fireEvent.changeText(search, 'STUDENT S');
    expect(shownNames()).toEqual(['S1', 'S2']);
    expect(headings()).toEqual(['STUDENTS']);
    await fireEvent.changeText(search, 'ax');
    expect(shownNames()).toEqual(['M']);
  });

  it('edge: no match shows the empty message', async () => {
    setStore(fakeStore('T'));
    await render(<RolesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Search users'), 'zzz');
    expect(screen.getByText("No users match 'zzz'")).toBeTruthy();
  });

  it('AC6: the teacher row has a Teacher badge and no action; nothing offers "Make teacher"', async () => {
    setStore(fakeStore('T'));
    await render(<RolesScreen />);
    expect(within(row('T')).getByText('Teacher')).toBeTruthy();
    expect(within(row('T')).queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Make teacher/)).toBeNull();
  });
});

describe('Switching roles', () => {
  it('AC3: "Make mentor" asks with the access warning, then sets the role', async () => {
    confirm.mockResolvedValue(true);
    const setUserRole = jest.fn(async () => {});
    setStore(fakeStore('T', { setUserRole }));
    await render(<RolesScreen />);
    await fireEvent.press(within(row('S2')).getByRole('button', { name: 'Make mentor' }));
    await waitFor(() => expect(setUserRole).toHaveBeenCalledWith('S2', 'mentor'));
    expect(confirm).toHaveBeenCalledWith(
      'Make mentor',
      "Make Student Sue a mentor? They will be able to see and check all students' homework and photos in every course.",
      'Make mentor',
    );
  });

  it('AC3: cancelling changes nothing', async () => {
    confirm.mockResolvedValue(false);
    const setUserRole = jest.fn(async () => {});
    setStore(fakeStore('T', { setUserRole }));
    await render(<RolesScreen />);
    await fireEvent.press(within(row('S2')).getByRole('button', { name: 'Make mentor' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it('AC4: "Make student" on a mentor who owns nothing asks, then sets the role', async () => {
    confirm.mockResolvedValue(true);
    const setUserRole = jest.fn(async () => {});
    setStore(fakeStore('T', { setUserRole }));
    await render(<RolesScreen />);
    await fireEvent.press(within(row('M2')).getByRole('button', { name: 'Make student' }));
    await waitFor(() => expect(setUserRole).toHaveBeenCalledWith('M2', 'student'));
    expect(confirm).toHaveBeenCalledWith('Make student', expect.stringContaining('Make Mentor Mo a student?'), 'Make student');
  });

  it('AC3/AC4: the user shows in the new section after the store refetches', async () => {
    setStore(fakeStore('T'));
    const { rerender } = await render(<RolesScreen />);
    expect(within(row('S2')).getByRole('button', { name: 'Make mentor' })).toBeTruthy();
    const base = fakeStore('T');
    setStore({ ...base, users: base.users.map((u) => (u.id === 'S2' ? { ...u, role: 'mentor' as const } : u)) });
    await rerender(<RolesScreen />);
    expect(shownNames()).toEqual(['T', 'M', 'M2', 'N', 'S2', 'S3', 'S1']);
    expect(within(row('S2')).getByRole('button', { name: 'Make student' })).toBeTruthy();
  });

  it('AC5: a mentor who owns courses is refused with names of the courses, without asking', async () => {
    const setUserRole = jest.fn(async () => {});
    setStore(fakeStore('T', { setUserRole }));
    await render(<RolesScreen />);
    await fireEvent.press(within(row('M')).getByRole('button', { name: 'Make student' }));
    expect(await screen.findByText('Mentor Max owns 1 course(s): Algebra. Reassign them first')).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it('AC9: a database rejection is shown, not a crash, and the list is unchanged', async () => {
    confirm.mockResolvedValue(true);
    const setUserRole = jest.fn(async () => {
      throw new Error('Mentor Mo owns 1 course(s): Chemistry. Reassign them first');
    });
    setStore(fakeStore('T', { setUserRole }));
    await render(<RolesScreen />);
    await fireEvent.press(within(row('M2')).getByRole('button', { name: 'Make student' }));
    expect(await screen.findByText('Mentor Mo owns 1 course(s): Chemistry. Reassign them first')).toBeTruthy();
    expect(within(row('M2')).getByRole('button', { name: 'Make student' })).toBeEnabled();
    expect(shownNames()).toEqual(['T', 'M', 'M2', 'N', 'S3', 'S1', 'S2']);
  });

  it('edge: actions are locked while a change is saving', async () => {
    confirm.mockResolvedValue(true);
    let finish: () => void = () => {};
    const setUserRole = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setStore(fakeStore('T', { setUserRole }));
    await render(<RolesScreen />);
    await fireEvent.press(within(row('S2')).getByRole('button', { name: 'Make mentor' }));
    await waitFor(() => expect(setUserRole).toHaveBeenCalled());
    expect(within(row('S1')).getByRole('button', { name: 'Make mentor' })).toBeDisabled();
    finish();
    await waitFor(() => expect(within(row('S1')).getByRole('button', { name: 'Make mentor' })).toBeEnabled());
  });

  it('pull-to-refresh reloads the list', async () => {
    const refresh = jest.fn(async () => {});
    setStore(fakeStore('T', { refresh }));
    const { container } = await render(<RolesScreen />);
    // SectionList's RefreshControl: call onRefresh through the list's props.
    const list = container.queryAll((n) => typeof n.props.onRefresh === 'function')[0];
    await list.props.onRefresh();
    expect(refresh).toHaveBeenCalled();
  });
});
