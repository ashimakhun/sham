// ARU-73: the mentor's Listener switch on the Homework tab shows the New (N) count as a badge, on both tabs.
// Course A is owned by mentor M, with M2 and S1 as listeners. Course B is owned by M2.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import { colors } from '@/lib/theme';
import type { HomeworkAssignment } from '@/lib/types';
import { listenerTabLabel } from '@/lib/unread';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const hidden = { includeHiddenElements: true };
const asg = (id: string, courseId = 'A', day = 20): HomeworkAssignment => ({
  id,
  courseId,
  meetingId: `m-${id}`,
  title: `Assignment ${id}`,
  description: '',
  createdById: courseId === 'A' ? 'M' : 'M2',
  createdAt: `2026-10-${day}T10:00:00.000Z`,
});
const ownB = { ...courseB, createdById: 'M2' };
const members = [member('A', 'S1'), member('A', 'M2')];
const store = (over = {}) => fakeStore('M2', { courses: [ownB, courseA], courseMembers: members, ...over });
const listenerTab = () => screen.getByRole('tab', { name: /^Listener/ });
const badge = () => screen.queryByTestId('unread-badge', hidden);

beforeEach(() => jest.clearAllMocks());

describe('AC1 / AC2 / AC8: the badge on Listener', () => {
  it('N > 0: Listener shows N on the Owner tab and the Listener tab, equal to New (N); Owner has none', async () => {
    setStore(store({ assignments: [asg('a1'), asg('a2', 'A', 21), asg('a3', 'A', 22)] }));
    await render(<HomeworkScreen />);
    expect(screen.getByText(/^To check/)).toBeTruthy(); // opens on Owner
    expect(within(listenerTab()).getByText('3', hidden)).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: 'Owner' })).queryByTestId('unread-badge', hidden)).toBeNull();
    await fireEvent.press(listenerTab());
    expect(screen.getByText('New (3)')).toBeTruthy(); // AC8: still opens on New
    expect(within(listenerTab()).getByText('3', hidden)).toBeTruthy();
  });

  it('0 new: no badge, no "0"', async () => {
    setStore(store({ assignments: [] }));
    await render(<HomeworkScreen />);
    expect(badge()).toBeNull();
    expect(screen.getByRole('tab', { name: 'Listener' })).toBeTruthy();
  });

  it('assignments of a course the mentor owns never count', async () => {
    setStore(store({ assignments: [asg('b1', 'B')] }));
    await render(<HomeworkScreen />);
    expect(badge()).toBeNull();
  });

  it.each(['S1', 'T'] as const)('%s has no switch and no badge', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, assignments: [asg('a1')] }));
    await render(<HomeworkScreen />);
    expect(screen.queryByRole('tab', { name: /^Listener/ })).toBeNull();
    expect(badge()).toBeNull();
  });
});

describe('AC3: the badge look', () => {
  it.each([
    [1, '1'],
    [9, '9'],
    [10, '10'],
    [100, '99+'],
  ])('%s new → "%s", in the button colour with a white number, inline after the label', async (n, text) => {
    const many = Array.from({ length: n }, (_, i) => asg(`x${i}`));
    setStore(store({ assignments: many }));
    await render(<HomeworkScreen />);
    const tab = listenerTab();
    const b = within(tab).getByTestId('unread-badge', hidden);
    const style = StyleSheet.flatten(b.props.style);
    expect(style.backgroundColor).toBe(colors.primary);
    expect(style.position).toBeUndefined(); // inline, never over the label or the corners
    expect(StyleSheet.flatten(within(tab).getByText(text, hidden).props.style).color).toBe('#fff');
    const segment = StyleSheet.flatten(tab.props.style);
    expect(segment.flexDirection).toBe('row');
    expect(within(tab).getByText('Listener').props.numberOfLines).toBe(1);
  });
});

describe('AC4 / AC5 / AC6: live count', () => {
  it('sending homework drops it; a new assignment raises it; leaving the course drops that course', async () => {
    const assignments = [asg('a1'), asg('a2', 'A', 21)];
    setStore(store({ assignments }));
    const view = await render(<HomeworkScreen />);
    expect(within(listenerTab()).getByText('2', hidden)).toBeTruthy();
    // AC4: M2 sends homework for a1.
    const sent = hw({ id: 'h1', courseId: 'A', studentId: 'M2', assignmentId: 'a1' });
    setStore(store({ assignments, visibleHomework: [sent] }));
    await view.rerender(<HomeworkScreen />);
    expect(within(listenerTab()).getByText('1', hidden)).toBeTruthy();
    // AC5: a new assignment arrives while on Owner.
    setStore(store({ assignments: [...assignments, asg('a3', 'A', 22)], visibleHomework: [sent] }));
    await view.rerender(<HomeworkScreen />);
    expect(screen.getByText(/^To check/)).toBeTruthy();
    expect(within(listenerTab()).getByText('2', hidden)).toBeTruthy();
    // AC6: removed from A, but has sent homework, so the switch stays without a count.
    setStore(store({ assignments: [...assignments, asg('a3', 'A', 22)], visibleHomework: [sent], courseMembers: [member('A', 'S1')] }));
    await view.rerender(<HomeworkScreen />);
    expect(screen.getByRole('tab', { name: 'Listener' })).toBeTruthy();
    expect(badge()).toBeNull();
  });
});

describe('AC7: screen readers', () => {
  it('reads "Listener, N new homework" as one tab with its selected state; "Listener" at 0', async () => {
    setStore(store({ assignments: [asg('a1'), asg('a2', 'A', 21), asg('a3', 'A', 22)] }));
    await render(<HomeworkScreen />);
    const tab = screen.getByRole('tab', { name: 'Listener, 3 new homework' });
    expect(tab.props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(tab);
    expect(screen.getByRole('tab', { name: 'Listener, 3 new homework' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('tab', { name: 'Owner' })).toBeTruthy();
    // The badge itself is hidden from screen readers.
    expect(screen.queryByTestId('unread-badge')).toBeNull();
  });

  it('listenerTabLabel', () => {
    expect(listenerTabLabel(0)).toBe('Listener');
    expect(listenerTabLabel(1)).toBe('Listener, 1 new homework');
    expect(listenerTabLabel(150)).toBe('Listener, 99+ new homework');
  });
});
