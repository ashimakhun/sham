// ARU-14: listeners submit homework only to their courses; any mentor or the teacher checks it, never their own
// (product-owner decision 2026-10-28). UI side; the access rules are tested in
// supabase/tests/aru14_homework_by_course.test.sql.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import HomeworkDetailScreen from '@/app/homework/[id]';
import NewHomeworkScreen from '@/app/homework/new';
import { router } from 'expo-router';

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

describe('Add homework', () => {
  it('AC1: the picker lists only courses I am a listener of', async () => {
    setStore(fakeStore('S1', { courses: [courseB, courseA], courseMembers: members }));
    await render(<NewHomeworkScreen />);
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByText('Algebra')).toBeTruthy();
    expect(screen.queryByText('Biology')).toBeNull();
  });

  it('AC4 (changed by decision 2): the selected course\'s owner is shown as "Mentor: <owner>"', async () => {
    setStore(fakeStore('S1', { courseMembers: [...members, member('B', 'S1')] }));
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByText('Algebra'));
    expect(screen.getByText('Mentor: Mentor Max')).toBeTruthy();
    await fireEvent.press(screen.getByText('Biology'));
    expect(screen.getByText('Mentor: Mentor Nina')).toBeTruthy();
    // Any mentor or the teacher may check, so the screen must not promise that the owner will.
    expect(screen.queryByText(/will check it/)).toBeNull();
  });

  it('AC2: a mentor who is a listener submits to that course', async () => {
    const store = fakeStore('N', { courseMembers: members });
    setStore(store);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByText('Algebra'));
    await fireEvent.changeText(titleInput(), 'Mentor homework');
    await fireEvent.press(button('Send to mentor'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(store.addHomework).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'A', title: 'Mentor homework' }));
  });

  it('AC3/AC5: in no course (e.g. after being removed) the form explains why and cannot send', async () => {
    setStore(fakeStore('S2', { courseMembers: members }));
    await render(<NewHomeworkScreen />);
    expect(screen.getByText('You are not in any course yet — ask your teacher or mentor to add you')).toBeTruthy();
    await fireEvent.changeText(titleInput(), 'Exercises');
    expect(button('Send to mentor')).toBeDisabled();
  });

  it('edge: a database rejection is shown, not a crash', async () => {
    const store = fakeStore('S1', {
      courseMembers: members,
      addHomework: jest.fn(async () => {
        throw new Error('new row violates row-level security policy for table "homework"');
      }),
    });
    setStore(store);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByText('Algebra'));
    await fireEvent.changeText(titleInput(), 'x');
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

  it('AC2: a mentor who is a listener sees "+ Add homework" and "My homework" with their own submissions', async () => {
    setStore(fakeStore('N', { courseMembers: members, visibleHomework: list }));
    await render(<HomeworkScreen />);
    expect(button('+ Add homework')).toBeTruthy();
    // Default "To check": others' unchecked homework only, never my own.
    expect(screen.getByText('S1 in A')).toBeTruthy();
    expect(screen.queryByText('N in A')).toBeNull();
    expect(screen.getByText('To check (1)')).toBeTruthy();
    await fireEvent.press(screen.getByText('My homework'));
    expect(screen.getByText('N in A')).toBeTruthy();
    expect(screen.queryByText('S1 in A')).toBeNull();
  });

  it('AC3: a mentor in no course has no "+ Add homework" and no "My homework"', async () => {
    setStore(fakeStore('M2', { courseMembers: members, visibleHomework: list }));
    await render(<HomeworkScreen />);
    expect(screen.queryByRole('button', { name: '+ Add homework' })).toBeNull();
    expect(screen.queryByText('My homework')).toBeNull();
    // Decision: any mentor checks any course's homework.
    expect(screen.getByText('To check (2)')).toBeTruthy();
  });

  // Changed by ARU-19: students get "+ Add homework" only while they are a listener of a course.
  it('a student in a course gets "+ Add homework" and sees their own list', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    await render(<HomeworkScreen />);
    expect(button('+ Add homework')).toBeTruthy();
    expect(screen.getByText('No homework yet')).toBeTruthy();
  });

  it('a student in no course gets no "+ Add homework" (ARU-19)', async () => {
    setStore(fakeStore('S2', { courseMembers: members }));
    await render(<HomeworkScreen />);
    expect(screen.queryByRole('button', { name: '+ Add homework' })).toBeNull();
    expect(screen.getByText('No homework yet')).toBeTruthy();
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
