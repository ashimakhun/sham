// ARU-32: homework assignments on completed meetings, the New column for listeners. Rules under test in the
// database: supabase/tests/aru32_homework_assignments.test.sql.
// Course A owned by mentor M (S1 and M2 listeners); course B owned by N (M2 is not in B). S2 in no course.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import HomeworkScreen from '@/app/(tabs)/homework';
import CourseDetailScreen from '@/app/courses/[id]';
import AssignHomeworkScreen from '@/app/courses/[id]/meetings/[meetingId]/assign-homework';
import HomeworkDetailScreen from '@/app/homework/[id]';
import NewHomeworkScreen from '@/app/homework/new';
import type { HomeworkAssignment, Meeting } from '@/lib/types';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
// The native picker isn't available in jest: a text box that takes an ISO date stands in for it.
jest.mock('@/components/DateTimeField', () => {
  const { TextInput } = require('react-native');
  return {
    DateTimeField: ({ value, onChange }: { value: Date; onChange: (d: Date) => void }) => (
      <TextInput testID="deadline" value={value.toISOString()} onChangeText={(t: string) => onChange(new Date(t))} />
    ),
  };
});

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(-24),
  topic: `Topic ${over.id}`,
  status: 'completed',
  createdById: 'M',
  createdAt: at(-100),
  ...over,
});
const C1 = meeting({ id: 'C1', startsAt: at(-48) });
const C2 = meeting({ id: 'C2', startsAt: at(-24) });
const F = meeting({ id: 'F', startsAt: at(24), status: 'scheduled' });
const X = meeting({ id: 'X', status: 'canceled' });
const B1 = meeting({ id: 'B1', courseId: 'B', createdById: 'N' });
const asg = (over: Partial<HomeworkAssignment> & { id: string; meetingId: string }): HomeworkAssignment => ({
  courseId: 'A',
  title: `Assignment ${over.id}`,
  description: '',
  createdById: 'M',
  createdAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const a1 = asg({ id: 'a1', meetingId: 'C1', title: 'Old one', dueAt: at(-1), createdAt: '2026-10-20T10:00:00.000Z' });
const a2 = asg({
  id: 'a2',
  meetingId: 'C2',
  title: 'Fresh one',
  description: 'Read chapter 2',
  createdAt: '2026-10-25T10:00:00.000Z',
});
const b1 = asg({ id: 'b1', meetingId: 'B1', courseId: 'B', title: 'Biology hw', createdById: 'N' });
const members = [member('A', 'S1'), member('A', 'M2')];
const meetings = [C1, C2, F, X, B1];

const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(params, { id: 'A', meetingId: undefined, assignmentId: undefined });
});

describe('AC1/AC3/AC4: Meetings card', () => {
  it.each(['M', 'T'] as const)('%s sees Assign homework on a completed meeting without one only', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings, assignments: [a1] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('C2').getByRole('button', { name: 'Assign homework' })).toBeTruthy();
    expect(inMeeting('C1').queryByRole('button', { name: 'Assign homework' })).toBeNull();
    expect(inMeeting('F').queryByRole('button', { name: 'Assign homework' })).toBeNull();
    expect(inMeeting('X').queryByRole('button', { name: 'Assign homework' })).toBeNull();
    await fireEvent.press(inMeeting('C2').getByRole('button', { name: 'Assign homework' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/assign-homework',
      params: { id: 'A', meetingId: 'C2' },
    });
  });

  it.each(['S1', 'M2', 'N'] as const)('%s sees the homework line but no Assign homework', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings, assignments: [a1, a2] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Assign homework' })).toBeNull();
    expect(inMeeting('C1').getByText(/Homework: Old one/)).toBeTruthy();
    expect(inMeeting('C1').getByText(/Due /)).toBeTruthy();
    expect(inMeeting('C2').getByText(/No deadline/)).toBeTruthy();
  });
});

describe('AC1-AC4: Assign homework screen', () => {
  const open = async (who: 'M' | 'T' | 'N' | 'S1', meetingId = 'C2', over = {}) => {
    params.meetingId = meetingId;
    const store = fakeStore(who, { courseMembers: members, meetings, assignments: [a1], ...over });
    setStore(store);
    await render(<AssignHomeworkScreen />);
    return store;
  };

  it('saves title, description and no deadline, then goes back', async () => {
    const store = await open('M');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Exercises 1–10'), 'Exercises');
    await fireEvent.changeText(screen.getByPlaceholderText('What should listeners do?'), 'All of them');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.addAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 'C2',
        courseId: 'A',
        title: 'Exercises',
        description: 'All of them',
        dueAt: undefined,
      }),
    );
    expect(router.back).toHaveBeenCalled();
  });

  it('title is limited to 200 characters', async () => {
    await open('M');
    expect(screen.getByPlaceholderText('e.g. Exercises 1–10').props.maxLength).toBe(200);
  });

  it('a past deadline blocks Save with a message; Remove deadline clears it', async () => {
    const store = await open('T');
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Exercises 1–10'), 'Exercises');
    await fireEvent.press(screen.getByRole('button', { name: 'Add deadline' }));
    await fireEvent.changeText(screen.getByTestId('deadline'), at(-1));
    expect(screen.getByText('The deadline must be in the future.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('deadline'), at(5));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.addAssignment).toHaveBeenLastCalledWith(expect.objectContaining({ dueAt: expect.any(String) }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove deadline' }));
    expect(screen.queryByTestId('deadline')).toBeNull();
  });

  it('AC2: a failed save keeps the input and shows the error; a retry reuses the same id', async () => {
    const addAssignment = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(undefined);
    await open('M', 'C2', { addAssignment });
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Exercises 1–10'), 'Exercises');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByPlaceholderText('e.g. Exercises 1–10').props.value).toBe('Exercises');
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(addAssignment.mock.calls[0][0].id).toBe(addAssignment.mock.calls[1][0].id);
  });

  it.each(['N', 'S1'] as const)('AC4: %s opening the screen sees the not-allowed message', async (who) => {
    await open(who);
    expect(screen.getByText('Only the course owner or the teacher can assign homework.')).toBeTruthy();
  });

  it('AC3: scheduled, canceled or already assigned meetings show no form', async () => {
    await open('M', 'F');
    expect(screen.getByText('Homework can be assigned only to completed meetings.')).toBeTruthy();
  });

  it('AC3: a meeting that already has homework shows no form', async () => {
    await open('M', 'C1');
    expect(screen.getByText('This meeting already has homework.')).toBeTruthy();
  });
});

describe('AC5/AC6/AC9: New column', () => {
  const titles = () => screen.queryAllByText(/^(Old one|Fresh one|Biology hw)$/).map((t) => t.props.children);

  it('a student sees New (N) · Waiting (N) · Checked with New selected and unsent assignments, newest first', async () => {
    const sent = hw({ id: 'h1', courseId: 'A', assignmentId: 'a1', title: 'My answer' });
    setStore(fakeStore('S1', { courseMembers: members, meetings, assignments: [a1, a2, b1], visibleHomework: [] }));
    const view = await render(<HomeworkScreen />);
    expect(screen.getByText('New (2)')).toBeTruthy();
    expect(screen.queryByText('All')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add homework' })).toBeNull();
    expect(titles()).toEqual(['Fresh one', 'Old one']); // never course B's
    expect(screen.getByText('Overdue')).toBeTruthy(); // a1's deadline has passed
    expect(screen.getByText('Read chapter 2')).toBeTruthy();
    expect(screen.getAllByText(/^Meeting /)).toHaveLength(2);
    // Sending homework for a1 (live update) moves it out of New into Waiting.
    setStore(fakeStore('S1', { courseMembers: members, meetings, assignments: [a1, a2, b1], visibleHomework: [sent] }));
    await view.rerender(<HomeworkScreen />);
    expect(screen.getByText('New (1)')).toBeTruthy();
    expect(screen.getByText('Waiting (1)')).toBeTruthy();
    expect(titles()).toEqual(['Fresh one']);
  });

  it('Add homework on a card opens the form for that assignment', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings, assignments: [a2] }));
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add homework' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/homework/new', params: { assignmentId: 'a2' } });
  });

  it('a mentor listener gets New on the Listener tab (opening on New); a course they own never shows there', async () => {
    const ownB = { ...courseB, createdById: 'M2' };
    setStore(fakeStore('M2', { courses: [ownB, courseA], courseMembers: members, meetings, assignments: [a2, b1] }));
    await render(<HomeworkScreen />);
    expect(screen.getByText(/^To check/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Listener' }));
    expect(screen.getByText('New (1)')).toBeTruthy();
    expect(titles()).toEqual(['Fresh one']);
  });

  it('the teacher view is unchanged (no New)', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings, assignments: [a1, a2] }));
    await render(<HomeworkScreen />);
    expect(screen.queryByText(/^New/)).toBeNull();
    expect(screen.getByText(/^To check/)).toBeTruthy();
  });

  it('AC9: empty New shows its hint; in no course, the no-course hint', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings }));
    const view = await render(<HomeworkScreen />);
    expect(screen.getByText('No new homework')).toBeTruthy();
    expect(screen.getByText('Homework your mentor assigns after a meeting will appear here.')).toBeTruthy();
    setStore(fakeStore('S2', { courseMembers: members, meetings }));
    await view.rerender(<HomeworkScreen />);
    expect(screen.getByText('You are not in any course yet — ask your teacher or mentor to add you.')).toBeTruthy();
  });

  it('Overdue appears when the deadline passes while the screen is open', async () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      const soon = asg({
        id: 's',
        meetingId: 'C2',
        title: 'Fresh one',
        dueAt: new Date(Date.now() + 10_000).toISOString(),
      });
      setStore(fakeStore('S1', { courseMembers: members, meetings, assignments: [soon] }));
      await render(<HomeworkScreen />);
      expect(screen.queryByText('Overdue')).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(31_000);
      });
      expect(screen.getByText('Overdue')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AC7/AC8: sending homework for an assignment', () => {
  it('course and assignment are fixed, the title is prefilled; sending passes the assignment', async () => {
    params.assignmentId = 'a2';
    const store = fakeStore('S1', { courseMembers: members, meetings, assignments: [a2] });
    setStore(store);
    await render(<NewHomeworkScreen />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('Algebra')).toBeTruthy();
    const title = screen.getByPlaceholderText('e.g. Fractions — exercises 1–10');
    expect(title.props.value).toBe('Fresh one');
    await fireEvent.changeText(title, 'My answer');
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    expect(store.addHomework).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'A', assignmentId: 'a2', title: 'My answer' }),
    );
    expect(router.back).toHaveBeenCalled();
  });

  it('AC8: "already sent" from the store is shown and the form stays', async () => {
    params.assignmentId = 'a2';
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        meetings,
        assignments: [a2],
        addHomework: jest.fn(async () => {
          throw new Error('You have already sent homework for this assignment.');
        }),
      }),
    );
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    expect(await screen.findByText('You have already sent homework for this assignment.')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('AC10: homework details', () => {
  it('shows the assignment, its meeting and deadline; old homework shows none', async () => {
    const linked = hw({ id: 'h1', courseId: 'A', assignmentId: 'a1', title: 'Linked' });
    const old = hw({ id: 'h2', courseId: 'A', title: 'Old' });
    params.id = 'h1';
    setStore(fakeStore('M', { courseMembers: members, meetings, assignments: [a1], visibleHomework: [linked, old] }));
    const view = await render(<HomeworkDetailScreen />);
    const line = screen.getByTestId('homework-assignment');
    expect(line).toBeTruthy();
    expect(screen.getByText(/Assignment: Old one · Meeting /)).toBeTruthy();
    expect(screen.getByText(/Due /)).toBeTruthy();
    params.id = 'h2';
    await view.rerender(<HomeworkDetailScreen />);
    expect(screen.queryByTestId('homework-assignment')).toBeNull();
  });
});
