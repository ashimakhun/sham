// ARU-9 QA additions (revised TEST DESIGN, 13:09): AC 11 after an owner change, AC 4 with students in the course,
// and the "everyone else is a listener" edge case. Rules are tested in supabase/tests/aru9_course_owner*.test.sql.
import { fireEvent, render, screen } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import ChangeOwnerScreen from '@/app/courses/[id]/owner';
import NewHomeworkScreen from '@/app/homework/new';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

// After the change: A (Algebra) is owned by N instead of M. S1 is a listener of A.
const handedOver = { ...courseA, createdById: 'N' };

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('AC 11: a listener sees the new owner as the course mentor', () => {
  it('"Add homework" shows "Mentor: <new owner>" and never promises a checker', async () => {
    setStore(fakeStore('S1', { courses: [handedOver], courseMembers: [member('A', 'S1')] }));
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByText('Algebra'));
    expect(screen.getByText('Mentor: Mentor Nina')).toBeTruthy();
    expect(screen.queryByText(/Mentor Max/)).toBeNull();
    expect(screen.queryByText(/will check/)).toBeNull();
  });

  it('the Profile tab lists the course with "Mentor: <new owner>"', async () => {
    setStore(fakeStore('S1', { courses: [handedOver], courseMembers: [member('A', 'S1')] }));
    await render(<ProfileScreen />);
    expect(screen.getByText('Mentor: Mentor Nina')).toBeTruthy();
    expect(screen.queryByText('Mentor: Mentor Max')).toBeNull();
  });

  it('the new owner sees the course under "Courses I own" on Profile; the former owner no longer does', async () => {
    setStore(fakeStore('N', { courses: [handedOver], courseMembers: [member('A', 'S1')] }));
    const { unmount } = await render(<ProfileScreen />);
    expect(screen.getByText('Algebra')).toBeTruthy();
    expect(screen.getByText('Student Sam')).toBeTruthy();
    await unmount();
    setStore(fakeStore('M', { courses: [handedOver], courseMembers: [member('A', 'S1')] }));
    await render(<ProfileScreen />);
    expect(screen.queryByText('Algebra')).toBeNull();
    expect(screen.getByText('You do not own any courses yet.')).toBeTruthy();
  });
});

describe('Owner picker', () => {
  it('AC4/AC14: students in the course are never offered, even as listeners', async () => {
    setStore(fakeStore('T', { courseMembers: [member('A', 'S1'), member('A', 'S2'), member('A', 'S3')] }));
    await render(<ChangeOwnerScreen />);
    for (const s of ['Student Sam', 'Student Sue', 'Abby Student']) expect(screen.queryByText(s)).toBeNull();
    const names = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);
    expect(names).toEqual(['Mentor Mo', 'Mentor Nina', 'Teacher Tess']);
  });

  it('edge: everyone else is a listener (teacher aside) → they are all disabled and nothing is sent', async () => {
    const onlyStaff = [users.M, users.N, users.M2];
    const store = fakeStore('M', { users: onlyStaff, courseMembers: [member('A', 'N'), member('A', 'M2')] });
    setStore(store);
    await render(<ChangeOwnerScreen />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toBeDisabled();
    expect(screen.getAllByText('Listener of this course — remove them first')).toHaveLength(2);
    await fireEvent.press(buttons[0]);
    expect(store.changeCourseOwner).not.toHaveBeenCalled();
  });

  it('edge: an unknown course shows "Course not found"', async () => {
    params.id = 'nope';
    setStore(fakeStore('M'));
    await render(<ChangeOwnerScreen />);
    expect(screen.getByText('Course not found')).toBeTruthy();
  });
});
