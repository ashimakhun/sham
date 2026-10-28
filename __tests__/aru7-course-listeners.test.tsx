// ARU-7: teachers and mentors add and remove course listeners (UI side).
// The access rules themselves are tested against the database in supabase/tests/aru7_course_members.test.sql.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import HomeworkDetailScreen from '@/app/homework/[id]';
import AddListenersScreen from '@/app/courses/[id]/listeners';
import { ListenersSection } from '@/components/ListenersSection';
import { confirmDestructive } from '@/lib/confirm';
import { formatDate } from '@/lib/theme';
import { router } from 'expo-router';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/lib/confirm', () => ({ confirmDestructive: jest.fn() }));

const confirm = confirmDestructive as jest.Mock;
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const names = (els: { props: Record<string, unknown> }[]) => els.map((e) => e.props.children);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('Add listeners screen', () => {
  // A is owned by M; S1 is already a listener.
  const members = [member('A', 'S1')];

  it.each(['T', 'M', 'N', 'M2'] as const)(
    'AC1: %s sees students and mentors not yet in the course, never the owner or the teacher',
    async (who) => {
      setStore(fakeStore(who, { courseMembers: members }));
      await render(<AddListenersScreen />);
      const options = screen.getAllByRole('checkbox');
      const shown = options.map((o) => within(o).getAllByText(/./)[1].props.children);
      expect(shown).toEqual(['Abby Student', 'Mentor Mo', 'Mentor Nina', 'Student Sue']); // sorted by name
      expect(screen.queryByText('Mentor Max')).toBeNull(); // owner
      expect(screen.queryByText('Teacher Tess')).toBeNull(); // teacher
      expect(screen.queryByText('Student Sam')).toBeNull(); // AC4: already a listener
    },
  );

  it('AC1: several listeners are added in one go', async () => {
    const store = fakeStore('N', { courseMembers: members });
    setStore(store);
    await render(<AddListenersScreen />);
    expect(button('Add listener')).toBeDisabled();
    await fireEvent.press(screen.getByText('Student Sue'));
    await fireEvent.press(screen.getByText('Mentor Mo'));
    expect(screen.getByRole('checkbox', { name: /Student Sue/ })).toBeChecked();
    await fireEvent.press(button('Add 2 listeners'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(store.addListeners).toHaveBeenCalledTimes(1);
    expect(store.addListeners).toHaveBeenCalledWith('A', ['S2', 'M2']);
  });

  it('AC1: tapping a selected person again unselects them', async () => {
    setStore(fakeStore('M', { courseMembers: members }));
    await render(<AddListenersScreen />);
    await fireEvent.press(screen.getByText('Student Sue'));
    await fireEvent.press(screen.getByText('Student Sue'));
    expect(screen.getByRole('checkbox', { name: /Student Sue/ })).not.toBeChecked();
    expect(button('Add listener')).toBeDisabled();
  });

  it('edge: on error the error is shown and the selection is kept', async () => {
    const addListeners = jest.fn().mockRejectedValue(new Error('Network request failed'));
    setStore(fakeStore('M', { courseMembers: members, addListeners }));
    await render(<AddListenersScreen />);
    await fireEvent.press(screen.getByText('Student Sue'));
    await fireEvent.press(button('Add listener'));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Student Sue/ })).toBeChecked();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('edge: nobody left to add', async () => {
    setStore(
      fakeStore('M', { courseMembers: ['S1', 'S2', 'S3', 'N', 'M2'].map((u) => member('A', u)) }),
    );
    await render(<AddListenersScreen />);
    expect(screen.getByText('Everyone is already in this course')).toBeTruthy();
  });

  it('AC7: a student opening the route sees "Not allowed"', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    await render(<AddListenersScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('Listeners section', () => {
  const members = [member('A', 'S1', '2026-10-05T10:00:00.000Z'), member('A', 'N', '2026-10-06T10:00:00.000Z'), member('B', 'S2')];

  it('AC2: shows name, role and date added, sorted by name, for this course only', async () => {
    setStore(fakeStore('M', { courseMembers: members }));
    await render(<ListenersSection course={courseA} />);
    expect(screen.getByText('LISTENERS (2)')).toBeTruthy();
    expect(names(screen.getAllByText(/^(Mentor Nina|Student Sam|Student Sue)$/))).toEqual(['Mentor Nina', 'Student Sam']);
    expect(screen.getByText('Mentor')).toBeTruthy();
    expect(screen.getByText('Student')).toBeTruthy();
    expect(screen.getByText(`Added ${formatDate('2026-10-05T10:00:00.000Z')}`)).toBeTruthy();
    expect(screen.getByText(`Added ${formatDate('2026-10-06T10:00:00.000Z')}`)).toBeTruthy();
  });

  it('edge: an empty course says "No listeners yet" and offers "+ Add listeners"', async () => {
    setStore(fakeStore('T'));
    await render(<ListenersSection course={courseB} />);
    expect(screen.getByText('No listeners yet')).toBeTruthy();
    await fireEvent.press(button('+ Add listeners'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/listeners', params: { id: 'B' } });
  });

  it('AC6: Remove asks with the homework count, then removes', async () => {
    const store = fakeStore('M2', { courseMembers: members, countListenerHomework: jest.fn(async () => 2) });
    setStore(store);
    confirm.mockResolvedValue(true);
    await render(<ListenersSection course={courseA} />);
    const rows = screen.getAllByRole('button', { name: 'Remove' });
    await fireEvent.press(rows[1]); // sorted: Mentor Nina, Student Sam
    await waitFor(() => expect(store.removeListener).toHaveBeenCalledWith('A', 'S1'));
    expect(store.countListenerHomework).toHaveBeenCalledWith('A', 'S1');
    expect(confirm).toHaveBeenCalledWith(
      'Remove listener',
      'Remove Student Sam from Algebra? Their 2 homework for this course will be deleted.',
      'Remove',
    );
  });

  it('AC6: with no homework the second sentence is left out', async () => {
    const store = fakeStore('T', { courseMembers: members, countListenerHomework: jest.fn(async () => 0) });
    setStore(store);
    confirm.mockResolvedValue(true);
    await render(<ListenersSection course={courseA} />);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Remove' })[0]);
    await waitFor(() => expect(store.removeListener).toHaveBeenCalledWith('A', 'N'));
    expect(confirm).toHaveBeenCalledWith('Remove listener', 'Remove Mentor Nina from Algebra?', 'Remove');
  });

  it('AC6: cancelling the confirmation removes nobody', async () => {
    const store = fakeStore('M', { courseMembers: members, countListenerHomework: jest.fn(async () => 1) });
    setStore(store);
    confirm.mockResolvedValue(false);
    await render(<ListenersSection course={courseA} />);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Remove' })[1]);
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(store.removeListener).not.toHaveBeenCalled();
  });

  it('edge: a failed removal shows the error instead of crashing', async () => {
    const removeListener = jest.fn().mockRejectedValue(new Error('Only a teacher or mentor can do this.'));
    setStore(fakeStore('M', { courseMembers: members, removeListener }));
    confirm.mockResolvedValue(true);
    await render(<ListenersSection course={courseA} />);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Remove' })[1]);
    expect(await screen.findByText('Only a teacher or mentor can do this.')).toBeTruthy();
    expect(screen.getByText('Student Sam')).toBeTruthy();
  });

  it('AC7: a mentor who is only a listener (N in A) can still add and remove', async () => {
    setStore(fakeStore('N', { courseMembers: members }));
    await render(<ListenersSection course={courseA} />);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
    expect(button('+ Add listeners')).toBeTruthy();
  });

  it('AC7/AC8: a student listener sees the listeners but no "Add listeners" or "Remove"', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    await render(<ListenersSection course={courseA} />);
    expect(screen.getByText('LISTENERS (2)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add listeners' })).toBeNull();
  });

  it('AC8: a student who is not a listener does not see the section', async () => {
    setStore(fakeStore('S2', { courseMembers: [member('B', 'S2')] }));
    await render(<ListenersSection course={courseA} />);
    expect(screen.queryByText(/LISTENERS/)).toBeNull();
  });
});

describe('Profile tab', () => {
  it('AC9: a student sees the courses they attend with the owner as mentor', async () => {
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1'), member('B', 'S1')] }));
    await render(<ProfileScreen />);
    expect(screen.getByText('MY COURSES')).toBeTruthy();
    expect(screen.getByText('Mentor: Mentor Max')).toBeTruthy();
    expect(screen.getByText('Mentor: Mentor Nina')).toBeTruthy();
    expect(screen.queryByText('COURSES I OWN')).toBeNull();
  });

  it('AC9: a student in no course sees the "No mentor yet" hint', async () => {
    setStore(fakeStore('S2'));
    await render(<ProfileScreen />);
    expect(screen.getByText('No mentor yet — ask your teacher or mentor to add you to a course')).toBeTruthy();
  });

  it('AC9: a mentor sees the courses they own with their listeners, and the courses they attend', async () => {
    setStore(fakeStore('N', { courseMembers: [member('A', 'N'), member('B', 'S1'), member('B', 'S3')] }));
    await render(<ProfileScreen />);
    expect(screen.getByText('COURSES I OWN')).toBeTruthy();
    expect(screen.getByText('Abby Student, Student Sam')).toBeTruthy();
    expect(screen.getByText('MY COURSES')).toBeTruthy();
    expect(screen.getByText('Mentor: Mentor Max')).toBeTruthy();
  });

  it('AC9: the teacher sees owned courses; the old mentor_id sections are gone', async () => {
    setStore(fakeStore('T', { courses: [{ ...courseB, id: 'C', title: 'Chemistry', createdById: 'T' }] }));
    await render(<ProfileScreen />);
    expect(screen.getByText('Chemistry')).toBeTruthy();
    expect(screen.getByText('No listeners yet')).toBeTruthy();
    expect(screen.queryByText('MY COURSES')).toBeNull();
    expect(screen.queryByText(/Your mentor|Your students/)).toBeNull();
  });

  it('AC9: tapping a course opens it', async () => {
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')] }));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByText('Algebra'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });
});

it('edge: homework removed while open shows "Homework not found"', async () => {
  params.id = 'gone';
  setStore(fakeStore('S1'));
  await render(<HomeworkDetailScreen />);
  expect(screen.getByText('Homework not found')).toBeTruthy();
});
