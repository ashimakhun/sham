// ARU-9 QA additions (revised TEST DESIGN, 13:09): AC 11 after an owner change, AC 4 with students in the course,
// and the "everyone else is a listener" edge case. Rules are tested in supabase/tests/aru9_course_owner*.test.sql.
import { fireEvent, render, screen } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
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
  // Changed by ARU-32: the form opens from an assignment with the course fixed (no course picker).
  it('"Add homework" shows "Mentor: <new owner>" and never promises a checker', async () => {
    params.assignmentId = 'asgA';
    setStore(
      fakeStore('S1', { courses: [handedOver], courseMembers: [member('A', 'S1')], assignments: [{ id: 'asgA', meetingId: 'mA', courseId: 'A', title: 'Exercises 1-10', description: '', createdById: 'M', createdAt: '2026-10-20T10:00:00.000Z' }] }),
    );
    await render(<NewHomeworkScreen />);
    expect(screen.getByText('Mentor: Mentor Nina')).toBeTruthy();
    expect(screen.queryByText(/Mentor Max/)).toBeNull();
    expect(screen.queryByText(/will check/)).toBeNull();
    params.assignmentId = undefined;
  });

  // ARU-98 removed the course cards from Profile: these checks now look at the Courses tab, where courses are listed.
  it('the Courses tab lists the course under "Courses I\'m in" with "Owner: <new owner>"', async () => {
    setStore(fakeStore('S1', { courses: [handedOver], courseMembers: [member('A', 'S1')] }));
    await render(<CoursesScreen />);
    expect(screen.getByText("COURSES I'M IN")).toBeTruthy();
    expect(screen.getByText(/^Mentor Nina · /)).toBeTruthy();
    expect(screen.queryByText(/^Mentor Max · /)).toBeNull();
  });

  it('the new owner sees the course under "Courses I own" on the Courses tab; the former owner no longer does', async () => {
    setStore(fakeStore('N', { courses: [handedOver], courseMembers: [member('A', 'S1')] }));
    const { unmount } = await render(<CoursesScreen />);
    expect(screen.getByText('COURSES I OWN')).toBeTruthy();
    expect(screen.getByText('Algebra')).toBeTruthy();
    await unmount();
    setStore(fakeStore('M', { courses: [handedOver], courseMembers: [member('A', 'S1')] }));
    await render(<CoursesScreen />);
    expect(screen.queryByText('COURSES I OWN')).toBeNull();
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
