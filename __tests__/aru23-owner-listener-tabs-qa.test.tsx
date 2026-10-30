// ARU-23 QA additions to aru23-owner-listener-tabs.test.tsx, from the TEST DESIGN: a mentor who owns one course
// and attends another, sending homework from the Listener tab (AC 5; since ARU-32 from a New card), pull-to-refresh on the Listener tab (AC 10),
// a membership of a course that isn't loaded (analysis note 2), M4's Listener / Checked list (AC 6) and the
// teacher's Checked list (AC 8).
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import type { Homework } from '@/lib/types';
import { router } from 'expo-router';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

// M owns A (courseA.createdById = 'M') and is a listener of B; S1 is in A.
const HOMEWORK: Homework[] = [
  hw({ id: 'a1', courseId: 'A', studentId: 'S1', title: 'S1 waiting in A' }),
  hw({ id: 'a2', courseId: 'A', studentId: 'S1', title: 'S1 checked in A', status: 'checked', checkedById: 'M' }),
  hw({ id: 'b1', courseId: 'B', studentId: 'M', title: 'Max waiting in B' }),
  hw({ id: 'b2', courseId: 'B', studentId: 'N', title: 'Nina waiting in B' }),
];
const members = [member('A', 'S1'), member('B', 'M')];
// ARU-32: one assignment in the course M owns (A) and one in the course M listens to (B).
const asg = (id: string, courseId: string, title: string, createdById: string) => ({
  id, meetingId: `m${id}`, courseId, title, description: '', createdById, createdAt: '2026-10-20T10:00:00.000Z',
});
const ASSIGNMENTS = [asg('asgA', 'A', 'Task in A', 'M'), asg('asgB', 'B', 'Task in B', 'N')];
const titles = () => screen.queryAllByText(/^(S1 |Max |Nina )/).map((t) => t.props.children);
const tab = (name: 'Owner' | 'Listener') => screen.queryByRole('tab', { name });
const addButton = () => screen.queryByRole('button', { name: '+ Add homework' });

beforeEach(() => jest.clearAllMocks());

describe('a mentor who owns course A and is a listener of course B', () => {
  const open = async () => {
    const store = fakeStore('M', {
      courses: [courseB, courseA],
      courseMembers: members,
      visibleHomework: HOMEWORK,
      assignments: ASSIGNMENTS,
    });
    setStore(store);
    const view = await render(<HomeworkScreen />);
    return { store, view };
  };

  it('AC2: Owner lists everyone else\'s homework in any course (not only A), never their own', async () => {
    await open();
    expect(tab('Owner')).toBeSelected();
    expect(titles()).toEqual(['S1 waiting in A', 'Nina waiting in B']);
    expect(screen.getByText('To check (2)')).toBeTruthy();
    expect(addButton()).toBeNull();
  });

  // Changed by ARU-32: Listener opens on New; homework is sent from a New card, not a top button.
  it('AC4/AC5: Listener lists only their own B homework, and New only B\'s assignment (never their own course A)', async () => {
    await open();
    await fireEvent.press(tab('Listener')!);
    expect(screen.getByText('New (1)')).toBeTruthy();
    expect(screen.getByText('Task in B')).toBeTruthy();
    expect(screen.queryByText('Task in A')).toBeNull();
    expect(addButton()).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Add homework' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/homework/new', params: { assignmentId: 'asgB' } });
    await fireEvent.press(screen.getByText('Waiting (1)'));
    expect(titles()).toEqual(['Max waiting in B']);
  });

  it('ARU-32: the Owner tab never lists assignments', async () => {
    await open();
    expect(screen.queryByText('Task in A')).toBeNull();
    expect(screen.queryByText('Task in B')).toBeNull();
    expect(screen.queryByText(/^New/)).toBeNull();
  });

  it('AC10: pull-to-refresh on the Listener tab reloads', async () => {
    const { store, view } = await open();
    await fireEvent.press(tab('Listener')!);
    const list = view.container.queryAll((n) => typeof n.props.onRefresh === 'function')[0];
    list.props.onRefresh();
    expect(store.refresh).toHaveBeenCalled();
  });
});

it('note 2: a membership of a course that is not loaded gives no switcher and no button (same rule as the form)', async () => {
  setStore(fakeStore('N', { courses: [courseA], courseMembers: [member('B', 'N')], visibleHomework: [] }));
  await render(<HomeworkScreen />);
  expect(tab('Listener')).toBeNull();
  expect(addButton()).toBeNull();
});

it('AC6: a mentor with only earlier checked homework sees Waiting (0) and their item under Listener / Checked', async () => {
  const earlier = hw({ id: 'e1', courseId: 'A', studentId: 'M2', title: 'Max earlier', status: 'checked' });
  setStore(fakeStore('M2', { courseMembers: [], visibleHomework: [earlier, HOMEWORK[0]] }));
  await render(<HomeworkScreen />);
  await fireEvent.press(tab('Listener')!);
  expect(screen.getByText('Waiting (0)')).toBeTruthy();
  expect(titles()).toEqual([]);
  await fireEvent.press(screen.getAllByText('Checked')[0]);
  expect(screen.getByText('Max earlier')).toBeTruthy();
  expect(screen.queryByText('S1 waiting in A')).toBeNull();
  expect(addButton()).toBeNull();
});

it('AC8: the teacher\'s Checked list shows checked homework from every course', async () => {
  setStore(fakeStore('T', { courseMembers: members, visibleHomework: HOMEWORK }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getAllByText('Checked')[0]);
  expect(titles()).toEqual(['S1 checked in A']);
  expect(tab('Owner')).toBeNull();
});
