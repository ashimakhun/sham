// ARU-9: course owner (UI side). Rules are tested in supabase/tests/aru9_course_owner.test.sql.
// M owns A; M2 is a mentor listener of A (the TEST DESIGN's L); N a mentor with no link; T the teacher; S1 a student.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import ChangeOwnerScreen from '@/app/courses/[id]/owner';
import { CourseCard } from '@/components/CourseCard';
import { formatDate } from '@/lib/theme';
import { router } from 'expo-router';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const members = [member('A', 'S1'), member('A', 'M2')];
const button = (name: string | RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('Owner label', () => {
  it('AC1: the course card and details say "Owner: <name>"', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    await render(<CourseCard course={courseA} />);
    expect(screen.getByText(`Owner: Mentor Max · ${formatDate(courseA.createdAt)}`)).toBeTruthy();
  });

  it('AC2: a new owner from the (live-refetched) store is shown', async () => {
    setStore(fakeStore('S1', { courses: [{ ...courseA, createdById: 'N' }], courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText(`Owner: Mentor Nina · ${formatDate(courseA.createdAt)}`)).toBeTruthy();
  });
});

describe('Change owner action', () => {
  it.each(['M', 'N', 'M2', 'T'] as const)('AC3: %s (owner, unrelated mentor, listener-mentor, teacher) sees it', async (who) => {
    setStore(fakeStore(who, { courseMembers: members }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(button('Change owner'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/owner', params: { id: 'A' } });
  });

  it('AC3: a student does not see it', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Change owner' })).toBeNull();
  });
});

describe('Owner picker', () => {
  it('AC4/AC6: lists teachers and mentors except the owner; a listener is disabled with a hint', async () => {
    setStore(fakeStore('T', { courseMembers: members }));
    await render(<ChangeOwnerScreen />);
    const names = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);
    expect(names).toEqual(['Mentor Mo', 'Mentor Nina', 'Teacher Tess']); // sorted; no M (owner), no students
    expect(button('Mentor Mo')).toBeDisabled();
    expect(screen.getByText('Listener of this course — remove them first')).toBeTruthy();
    expect(button('Mentor Nina')).toBeEnabled();
  });

  it('AC5: tapping a person changes the owner at once and goes back; the list is locked while saving', async () => {
    let finish: () => void = () => {};
    const changeCourseOwner = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setStore(fakeStore('M', { courseMembers: members, changeCourseOwner }));
    await render(<ChangeOwnerScreen />);
    await fireEvent.press(button('Mentor Nina'));
    expect(changeCourseOwner).toHaveBeenCalledWith('A', 'N');
    expect(button('Teacher Tess')).toBeDisabled(); // no second tap while saving
    finish();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(changeCourseOwner).toHaveBeenCalledTimes(1);
  });

  it('AC7: a rejection is shown and the picker stays open', async () => {
    const changeCourseOwner = jest.fn(async () => {
      throw new Error('Only a teacher or mentor can own a course.');
    });
    setStore(fakeStore('M', { courseMembers: members, changeCourseOwner }));
    await render(<ChangeOwnerScreen />);
    await fireEvent.press(button('Mentor Nina'));
    expect(await screen.findByText('Only a teacher or mentor can own a course.')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    expect(button('Mentor Nina')).toBeEnabled(); // re-enabled for a retry
  });

  it('AC14: a student opening the picker route is not allowed', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    await render(<ChangeOwnerScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });

  it('edge: nobody else to choose from', async () => {
    const onlyM = { M: users.M, S1: users.S1 };
    setStore(fakeStore('M', { users: Object.values(onlyM), courseMembers: members }));
    await render(<ChangeOwnerScreen />);
    expect(screen.getByText('No other teachers or mentors to choose from')).toBeTruthy();
  });
});
