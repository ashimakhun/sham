// ARU-32 QA additions to aru32-homework-assignments.test.tsx, from the TEST DESIGN: the New card's content and
// count (AC 6), an assignment leaving New once sent and moving to Waiting / Checked (AC 7), a listener removed and
// re-added (edge case), a student outside the course never seeing its assignments, a whitespace-only title and a
// double-tapped Save on the Assign homework screen (AC 1, AC 2), and the assignment line for any mentor (AC 10).
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import AssignHomeworkScreen from '@/app/courses/[id]/meetings/[meetingId]/assign-homework';
import HomeworkDetailScreen from '@/app/homework/[id]';
import { formatDateTime } from '@/lib/theme';
import type { HomeworkAssignment, Meeting } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/components/DateTimeField', () => ({ DateTimeField: () => null }));

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (id: string, courseId = 'A'): Meeting => ({
  id,
  courseId,
  startsAt: at(-24),
  topic: `Topic ${id}`,
  status: 'completed',
  createdById: courseId === 'A' ? 'M' : 'N',
  createdAt: at(-100),
});
const asg = (over: Partial<HomeworkAssignment> & { id: string; meetingId: string }): HomeworkAssignment => ({
  courseId: 'A',
  title: `Assignment ${over.id}`,
  description: '',
  createdById: 'M',
  createdAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const MEETINGS = [meeting('C1'), meeting('C2'), meeting('B1', 'B')];
const past = asg({ id: 'a1', meetingId: 'C1', title: 'Past due', dueAt: at(-1), createdAt: '2026-10-20T10:00:00.000Z' });
const fresh = asg({
  id: 'a2',
  meetingId: 'C2',
  title: 'Fresh',
  description: 'Line one\nLine two\nLine three',
  dueAt: at(48),
  createdAt: '2026-10-25T10:00:00.000Z',
});
const bio = asg({ id: 'b1', meetingId: 'B1', courseId: 'B', title: 'Biology task', createdById: 'N' });
const ASSIGNMENTS = [past, fresh, bio];
const cards = () => screen.queryAllByRole('button', { name: 'Add homework' }).length;

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(params, { id: 'A', meetingId: undefined, assignmentId: undefined });
});

describe('AC6: the New card', () => {
  it('shows title, course, meeting time, a 2-line description, the deadline and Overdue only when it has passed', async () => {
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], meetings: MEETINGS, assignments: ASSIGNMENTS }));
    await render(<HomeworkScreen />);
    expect(screen.getByText('New (2)')).toBeTruthy();
    expect(cards()).toBe(2); // N counts the cards; B's assignment isn't one (S1 isn't in B)
    expect(screen.queryByText('Biology task')).toBeNull();
    expect(screen.getAllByText('Algebra')).toHaveLength(2);
    expect(screen.getAllByText(`Meeting ${formatDateTime(MEETINGS[0].startsAt)}`)).toHaveLength(2);
    const description = screen.getByText('Line one\nLine two\nLine three');
    expect(description.props.numberOfLines).toBe(2);
    expect(screen.getByText(`Due ${formatDateTime(fresh.dueAt!)}`)).toBeTruthy();
    expect(screen.getAllByText('Overdue')).toHaveLength(1); // only the past one
    // Newest assignment first.
    const titles = screen.getAllByText(/^(Fresh|Past due)$/).map((t) => t.props.children);
    expect(titles).toEqual(['Fresh', 'Past due']);
  });

  it('shows "No deadline" when there is none', async () => {
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], meetings: MEETINGS, assignments: [asg({ id: 'n', meetingId: 'C1' })] }));
    await render(<HomeworkScreen />);
    expect(screen.getByText('No deadline')).toBeTruthy();
    expect(screen.queryByText('Overdue')).toBeNull();
  });

  it('a student who is not in the course never gets its assignments, even if the store lists them', async () => {
    setStore(fakeStore('S2', { courseMembers: [member('A', 'S1')], meetings: MEETINGS, assignments: ASSIGNMENTS }));
    await render(<HomeworkScreen />);
    expect(screen.getByText('New (0)')).toBeTruthy();
    expect(cards()).toBe(0);
    expect(screen.getByText('You are not in any course yet — ask your teacher or mentor to add you.')).toBeTruthy();
  });
});

describe('AC7: sending moves the assignment out of New', () => {
  it('sent → Waiting; checked → Checked; never back in New', async () => {
    const base = { courseMembers: [member('A', 'S1')], meetings: MEETINGS, assignments: ASSIGNMENTS };
    setStore(fakeStore('S1', base));
    const view = await render(<HomeworkScreen />);
    expect(screen.getByText('New (2)')).toBeTruthy();
    const sent = hw({ id: 'h1', courseId: 'A', studentId: 'S1', assignmentId: 'a2', title: 'My answer' });
    setStore(fakeStore('S1', { ...base, visibleHomework: [sent] }));
    await view.rerender(<HomeworkScreen />);
    expect(screen.getByText('New (1)')).toBeTruthy();
    expect(screen.queryByText('Fresh')).toBeNull();
    await fireEvent.press(screen.getByText('Waiting (1)'));
    expect(screen.getByText('My answer')).toBeTruthy();
    setStore(fakeStore('S1', { ...base, visibleHomework: [{ ...sent, status: 'checked', checkedById: 'M' }] }));
    await view.rerender(<HomeworkScreen />);
    expect(screen.getByText('Waiting (0)')).toBeTruthy();
    await fireEvent.press(screen.getAllByText('Checked')[0]);
    expect(screen.getByText('My answer')).toBeTruthy();
    expect(screen.getByText('New (1)')).toBeTruthy();
  });
});

describe('edge: listener removed and added back', () => {
  it('assignments leave New when removed and come back (unsent) when re-added', async () => {
    const base = { meetings: MEETINGS, assignments: ASSIGNMENTS };
    setStore(fakeStore('S1', { ...base, courseMembers: [member('A', 'S1')] }));
    const view = await render(<HomeworkScreen />);
    expect(cards()).toBe(2);
    setStore(fakeStore('S1', { ...base, courseMembers: [] }));
    await view.rerender(<HomeworkScreen />);
    expect(cards()).toBe(0);
    expect(screen.getByText('New (0)')).toBeTruthy();
    setStore(fakeStore('S1', { ...base, courseMembers: [member('A', 'S1')] }));
    await view.rerender(<HomeworkScreen />);
    expect(cards()).toBe(2);
  });
});

describe('AC1/AC2: Assign homework screen', () => {
  const open = async (over = {}) => {
    params.meetingId = 'C2';
    const store = fakeStore('M', { courseMembers: [member('A', 'S1')], meetings: MEETINGS, assignments: [], ...over });
    setStore(store);
    await render(<AssignHomeworkScreen />);
    return store;
  };

  it('a whitespace-only title keeps Save disabled', async () => {
    await open();
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Exercises 1–10'), '    ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('while saving, Save is disabled and a second tap sends nothing', async () => {
    let finish!: () => void;
    const addAssignment = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    await open({ addAssignment });
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Exercises 1–10'), 'Exercises');
    // Not awaited: the save stays pending until finish() is called.
    void fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    await fireEvent.press(saving);
    expect(addAssignment).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });
});

describe('AC10: homework details', () => {
  it.each(['N', 'T', 'S1'] as const)('%s sees the assignment line on linked homework', async (who) => {
    const linked = hw({ id: 'h1', courseId: 'A', studentId: 'S1', assignmentId: 'a2', title: 'Linked' });
    params.id = 'h1';
    setStore(fakeStore(who, { courseMembers: [member('A', 'S1')], meetings: MEETINGS, assignments: ASSIGNMENTS, visibleHomework: [linked] }));
    await render(<HomeworkDetailScreen />);
    const line = screen.getByTestId('homework-assignment');
    expect(line).toHaveTextContent(/Assignment: Fresh · Meeting /);
    expect(line).toHaveTextContent(`Due ${formatDateTime(fresh.dueAt!)}`, { exact: false });
  });
});
