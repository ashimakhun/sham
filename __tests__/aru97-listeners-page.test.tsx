// ARU-97: Listeners on course details is a "LISTENERS (n) >" row that opens a Listeners page
// (list, X to remove, "+ Add listeners").
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import CourseDetailScreen from '@/app/courses/[id]';
import ListenersScreen from '@/app/courses/[id]/members';
import { confirmDestructive } from '@/lib/confirm';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/lib/confirm', () => ({ confirmDestructive: jest.fn() }));

const confirm = confirmDestructive as jest.Mock;
const hidden = { includeHiddenElements: true };
// A is owned by M; S1 and N are listeners of A; S2 is a listener of B only.
const members = [member('A', 'S1'), member('A', 'N'), member('B', 'S2')];

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('course details row (AC 1, 2, 10)', () => {
  it.each(['T', 'M', 'N', 'S1'] as const)('%s sees "LISTENERS (2)" with a chevron and no names, Remove or Add', async (who) => {
    setStore(fakeStore(who, { courseMembers: members }));
    await render(<CourseDetailScreen />);
    const row = screen.getByTestId('listeners-row');
    expect(screen.getByText('LISTENERS (2)')).toBeTruthy();
    expect(screen.getByTestId('icon-chevron-forward', hidden)).toBeTruthy();
    expect(row.props.accessibilityRole).toBe('button');
    expect(screen.queryByText('Student Sam')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add listeners' })).toBeNull();
  });

  it('tapping the row pushes the Listeners page for that course', async () => {
    setStore(fakeStore('T', { courseMembers: members }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(screen.getByTestId('listeners-row'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/members', params: { id: 'A' } });
  });

  it('with no listeners the row says "LISTENERS (0)" and still opens the page', async () => {
    setStore(fakeStore('T', { courseMembers: [] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('LISTENERS (0)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('listeners-row'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/members', params: { id: 'A' } });
  });
});

describe('Listeners page', () => {
  it('AC 3: sorted by name; empty course says "No listeners yet"', async () => {
    setStore(fakeStore('T', { courseMembers: members }));
    const view = await render(<ListenersScreen />);
    const shown = screen.getAllByText(/^(Mentor Nina|Student Sam|Student Sue)$/).map((e) => e.props.children);
    expect(shown).toEqual(['Mentor Nina', 'Student Sam']);
    setStore(fakeStore('T', { courseMembers: [] }));
    await view.rerender(<ListenersScreen />);
    expect(screen.getByText('No listeners yet')).toBeTruthy();
  });

  it('AC 4: teacher/mentor see an X per row labelled "Remove <name>", not the word Remove', async () => {
    setStore(fakeStore('M', { courseMembers: members }));
    await render(<ListenersScreen />);
    expect(screen.getByRole('button', { name: 'Remove Student Sam' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Mentor Nina' })).toBeTruthy();
    expect(screen.getAllByTestId('icon-close', hidden)).toHaveLength(2);
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('AC 5/6: X confirms, then removes; while removing every X is disabled', async () => {
    let finish: () => void = () => {};
    const removeListener = jest.fn(() => new Promise<void>((r) => (finish = r)));
    const store = fakeStore('T', { courseMembers: members, removeListener, countListenerHomework: jest.fn(async () => 1) });
    setStore(store);
    confirm.mockResolvedValue(true);
    await render(<ListenersScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Student Sam' }));
    await waitFor(() => expect(removeListener).toHaveBeenCalledWith('A', 'S1'));
    expect(confirm).toHaveBeenCalledWith(
      'Remove listener',
      'Remove Student Sam from Algebra? Their 1 homework for this course will be deleted.',
      'Remove',
    );
    expect(screen.getByRole('button', { name: 'Remove Mentor Nina' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Student Sam' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Mentor Nina' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Mentor Nina' })).toBeEnabled());
  });

  it('AC 7: "+ Add listeners" opens the existing Add listeners screen', async () => {
    setStore(fakeStore('N', { courseMembers: members }));
    await render(<ListenersScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '+ Add listeners' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/listeners', params: { id: 'A' } });
  });

  it('AC 8: a student listener sees the list read-only', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    await render(<ListenersScreen />);
    expect(screen.getByText('Mentor Nina')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add listeners' })).toBeNull();
  });

  it('AC 9: a student not in the course gets "Not allowed" and no names; no row on details', async () => {
    setStore(fakeStore('S2', { courseMembers: members }));
    const view = await render(<ListenersScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByText(/Student Sam|Mentor Nina/)).toBeNull();
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByTestId('listeners-row')).toBeNull();
  });

  it('a student listener removed meanwhile switches to "Not allowed"', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    const view = await render(<ListenersScreen />);
    expect(screen.getByText('Mentor Nina')).toBeTruthy();
    setStore(fakeStore('S1', { courseMembers: [member('A', 'N')] }));
    await view.rerender(<ListenersScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByText('Mentor Nina')).toBeNull();
  });

  it('unknown course: "Course not found"', async () => {
    params.id = 'nope';
    setStore(fakeStore('T', { courseMembers: members }));
    await render(<ListenersScreen />);
    expect(screen.getByText('Course not found')).toBeTruthy();
  });
});
