// ARU-14: listeners submit homework only to their courses; any mentor or the teacher checks it, never their own
// (product-owner decision 2026-10-28). UI side; the access rules are tested in
// supabase/tests/aru14_homework_by_course.test.sql.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import HomeworkDetailScreen from '@/app/homework/[id]';
import NewHomeworkScreen from '@/app/homework/new';
import { router } from 'expo-router';
import type { HomeworkAssignment } from '@/lib/types';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const titleInput = () => screen.getByPlaceholderText('e.g. Fractions — exercises 1–10');

// TEST DESIGN: M owns A, N owns B and is a listener of A; S1 is a listener of A only here.
const members = [member('A', 'S1'), member('A', 'N')];

beforeEach(() => {
  jest.clearAllMocks();
});

// Changed by ARU-32: homework is sent for an assignment (opened from New), with the course fixed; no course picker.
const asgA: HomeworkAssignment = {
  id: 'asgA',
  meetingId: 'mA',
  courseId: 'A',
  title: 'Exercises 1-10',
  description: '',
  createdById: 'M',
  createdAt: '2026-10-20T10:00:00.000Z',
};

describe('Add homework', () => {
  beforeEach(() => {
    params.assignmentId = 'asgA';
  });

  it('AC1: only an assignment of a course I am a listener of can be sent', async () => {
    setStore(fakeStore('S2', { courseMembers: members, assignments: [asgA] }));
    await render(<NewHomeworkScreen />);
    expect(screen.getByText('Open a homework assignment from New to send homework.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send to mentor' })).toBeNull();
  });

  it('AC4 (changed by decision 2): the course owner is shown as "Mentor: <owner>"', async () => {
    setStore(fakeStore('S1', { courseMembers: members, assignments: [asgA] }));
    await render(<NewHomeworkScreen />);
    expect(screen.getByText('Mentor: Mentor Max')).toBeTruthy();
    // Any mentor or the teacher may check, so the screen must not promise that the owner will.
    expect(screen.queryByText(/will check it/)).toBeNull();
  });

  it('AC2: a mentor who is a listener submits to that course', async () => {
    const store = fakeStore('N', { courseMembers: members, assignments: [asgA] });
    setStore(store);
    await render(<NewHomeworkScreen />);
    await fireEvent.changeText(titleInput(), 'Mentor homework');
    await fireEvent.press(button('Send to mentor'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(store.addHomework).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'A', assignmentId: 'asgA', title: 'Mentor homework' }),
    );
  });

  it('edge: a database rejection is shown, not a crash', async () => {
    const store = fakeStore('S1', {
      courseMembers: members,
      assignments: [asgA],
      addHomework: jest.fn(async () => {
        throw new Error('new row violates row-level security policy for table "homework"');
      }),
    });
    setStore(store);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(button('Send to mentor'));
    expect(await screen.findByText(/row-level security/)).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('Homework tab', () => {
  const list = [
    hw({ id: 'h1', courseId: 'A', title: 'S1 in A' }),
    hw({ id: 'h2', courseId: 'A', studentId: 'N', title: 'N in A' }),
    hw({ id: 'h3', courseId: 'A', title: 'S1 checked', status: 'checked' }),
  ];

  // Changed by ARU-23 and ARU-32: a listener-mentor's own homework is on the Listener tab (Waiting), no top button.
  it('AC2: a mentor who is a listener sees their own submissions on the Listener tab', async () => {
    setStore(fakeStore('N', { courseMembers: members, visibleHomework: list }));
    await render(<HomeworkScreen />);
    // Default Owner / "To check": others' unchecked homework only, never my own.
    expect(screen.getByText('S1 in A')).toBeTruthy();
    expect(screen.queryByText('N in A')).toBeNull();
    expect(screen.getByText('To check (1)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Listener' }));
    await fireEvent.press(screen.getByText('Waiting (1)'));
    expect(screen.getByText('N in A')).toBeTruthy();
    expect(screen.queryByText('S1 in A')).toBeNull();
  });

  it('AC3: a mentor in no course has no Listener tab', async () => {
    setStore(fakeStore('M2', { courseMembers: members, visibleHomework: list }));
    await render(<HomeworkScreen />);
    expect(screen.queryByRole('tab', { name: 'Listener' })).toBeNull();
    // Decision: any mentor checks any course's homework.
    expect(screen.getByText('To check (2)')).toBeTruthy();
  });

  it('a student in a course sees their own list under Waiting', async () => {
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: list.filter((h) => h.studentId === 'S1') }));
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByText('Waiting (1)'));
    expect(screen.getByText('S1 in A')).toBeTruthy();
  });

  it('edge: a mentor with nothing to check sees "Nothing to check"', async () => {
    setStore(fakeStore('M2', { courseMembers: members }));
    await render(<HomeworkScreen />);
    expect(screen.getByText('Nothing to check')).toBeTruthy();
  });
});

describe('Checking', () => {
  it.each(['M', 'M2', 'T'] as const)('AC6/AC10/decision: %s can check a listener\'s homework', async (who) => {
    params.id = 'h1';
    const store = fakeStore(who, { visibleHomework: [hw({ id: 'h1', courseId: 'B' })] });
    setStore(store);
    await render(<HomeworkDetailScreen />);
    await fireEvent.press(button('✓ Mark as checked'));
    await waitFor(() => expect(store.checkHomework).toHaveBeenCalledWith('h1', ''));
  });

  it('AC9: a mentor cannot check their own homework', async () => {
    params.id = 'h2';
    setStore(fakeStore('N', { visibleHomework: [hw({ id: 'h2', courseId: 'A', studentId: 'N' })] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.queryByRole('button', { name: '✓ Mark as checked' })).toBeNull();
  });

  it('roles: a student cannot check homework', async () => {
    params.id = 'h1';
    setStore(fakeStore('S1', { visibleHomework: [hw({ id: 'h1', courseId: 'A' })] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.queryByRole('button', { name: '✓ Mark as checked' })).toBeNull();
  });
});
