// ARU-14 QA additions to aru14-homework-by-course.test.tsx: the check rule as a unit, checked homework,
// the teacher's Homework tab, and AC 12 (no mentor_id wording left on "Add homework").
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import HomeworkDetailScreen from '@/app/homework/[id]';
import NewHomeworkScreen from '@/app/homework/new';
import { canCheckHomework } from '@/lib/roles';

import { fakeStore, hw, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

describe('canCheckHomework (mirrors the 0005 update policy)', () => {
  const s1Submitted = hw({ id: 'h1', courseId: 'A' });
  const nSubmitted = hw({ id: 'h2', courseId: 'A', studentId: 'N' });

  it.each(['M', 'N', 'M2', 'T'] as const)('%s can check a listener\'s unchecked homework', (who) => {
    expect(canCheckHomework(users[who], s1Submitted)).toBe(true);
  });
  it('AC9: nobody checks their own homework', () => {
    expect(canCheckHomework(users.N, nSubmitted)).toBe(false);
  });
  it('students and signed-out users cannot check', () => {
    expect(canCheckHomework(users.S2, s1Submitted)).toBe(false);
    expect(canCheckHomework(null, s1Submitted)).toBe(false);
  });
  it('already checked homework cannot be checked again', () => {
    expect(canCheckHomework(users.M, { ...s1Submitted, status: 'checked' })).toBe(false);
  });
});

describe('Homework details', () => {
  it('checked homework shows the feedback and no "Mark as checked"', async () => {
    params.id = 'h3';
    setStore(
      fakeStore('M', {
        visibleHomework: [hw({ id: 'h3', courseId: 'A', status: 'checked', checkedById: 'M2', mentorComment: 'Well done' })],
      }),
    );
    await render(<HomeworkDetailScreen />);
    expect(screen.getByText('Well done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '✓ Mark as checked' })).toBeNull();
  });
});

describe('Homework tab for the teacher', () => {
  it('AC10: the teacher sees homework to check, no "+ Add homework", and "No homework yet" when empty', async () => {
    setStore(fakeStore('T', { visibleHomework: [hw({ id: 'h1', courseId: 'B', title: 'S1 in B' })] }));
    const { unmount } = await render(<HomeworkScreen />);
    expect(screen.getByText('S1 in B')).toBeTruthy();
    expect(screen.getByText('To check (1)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Add homework' })).toBeNull();
    expect(screen.queryByText('My homework')).toBeNull();
    await unmount();
    setStore(fakeStore('T'));
    await render(<HomeworkScreen />);
    expect(screen.getByText('No homework yet')).toBeTruthy();
  });

  it('the "Checked" filter lists checked homework for a mentor', async () => {
    setStore(
      fakeStore('M2', {
        visibleHomework: [hw({ id: 'h1', courseId: 'A', title: 'Open one' }), hw({ id: 'h3', courseId: 'A', title: 'Done one', status: 'checked' })],
      }),
    );
    await render(<HomeworkScreen />);
    expect(screen.queryByText('Done one')).toBeNull();
    await fireEvent.press(screen.getByText('Checked'));
    expect(screen.getByText('Done one')).toBeTruthy();
    expect(screen.queryByText('Open one')).toBeNull();
  });
});

describe('Add homework (AC 12: no mentor_id)', () => {
  it('before a course is picked no mentor is named, and never "You do not have a mentor assigned yet"', async () => {
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')] }));
    await render(<NewHomeworkScreen />);
    expect(screen.queryByText(/^Mentor: /)).toBeNull();
    expect(screen.queryByText(/mentor assigned/)).toBeNull();
  });

  // Changed by ARU-32: homework is sent for an assignment; the rule that stays is "only for a course I attend".
  it('AC1: an assignment of a course the user was removed from cannot be sent, even if the store still lists it', async () => {
    params.assignmentId = 'asgA';
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S2')], assignments: [{ id: 'asgA', meetingId: 'mA', courseId: 'A', title: 'Exercises 1-10', description: '', createdById: 'M', createdAt: '2026-10-20T10:00:00.000Z' }] }));
    await render(<NewHomeworkScreen />);
    expect(screen.getByText('Open a homework assignment from New to send homework.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
    params.assignmentId = undefined;
  });
});
