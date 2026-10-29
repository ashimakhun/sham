// ARU-21: students see "Waiting (N)" instead of "To check (N)" on their Homework tab; mentors and the teacher
// keep today's filters.
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const S1_HOMEWORK = [
  hw({ id: 'h1', courseId: 'A', title: 'Waiting one' }),
  hw({ id: 'h2', courseId: 'A', title: 'Waiting two' }),
  hw({ id: 'h3', courseId: 'A', title: 'Checked one', status: 'checked', checkedById: 'M' }),
];
const members = [member('A', 'S1'), member('A', 'M2')];

beforeEach(() => jest.clearAllMocks());

it('AC1/AC3: a student sees Waiting, Checked, All (in order), "All" selected, and no "To check" anywhere', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: S1_HOMEWORK }));
  await render(<HomeworkScreen />);
  // The filter row comes first in the tree; status badges on the cards ("Checked") come after it.
  const filters = screen.getAllByText(/^(Waiting \(\d+\)|To check \(\d+\)|Checked|All|My homework)$/).slice(0, 3);
  expect(filters.map((t) => t.props.children)).toEqual(['Waiting (2)', 'Checked', 'All']);
  expect(screen.queryByText(/To check/)).toBeNull();
  expect(screen.queryByText('My homework')).toBeNull();
  // "All" is the default: every item is listed.
  expect(screen.getByText('Waiting one')).toBeTruthy();
  expect(screen.getByText('Checked one')).toBeTruthy();
});

it('AC2: "Waiting (2)" lists exactly the 2 submitted items; Checked lists 1', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: S1_HOMEWORK }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Waiting (2)'));
  expect(screen.getByText('Waiting one')).toBeTruthy();
  expect(screen.getByText('Waiting two')).toBeTruthy();
  expect(screen.queryByText('Checked one')).toBeNull();
  await fireEvent.press(screen.getAllByText('Checked')[0]);
  expect(screen.getByText('Checked one')).toBeTruthy();
  expect(screen.queryByText('Waiting one')).toBeNull();
});

it('AC4: after the homework is checked and the store refetches, the label reads Waiting (0)', async () => {
  const one = [hw({ id: 'h1', courseId: 'A', title: 'Only one' })];
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: one }));
  const view = await render(<HomeworkScreen />);
  expect(screen.getByText('Waiting (1)')).toBeTruthy();
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [{ ...one[0], status: 'checked' }] }));
  await view.rerender(<HomeworkScreen />);
  expect(screen.getByText('Waiting (0)')).toBeTruthy();
});

it('AC5: a student with no homework sees Waiting (0) and the existing empty state', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [] }));
  await render(<HomeworkScreen />);
  expect(screen.getByText('Waiting (0)')).toBeTruthy();
  expect(screen.getByText('No homework yet')).toBeTruthy();
});

describe('AC6: mentors and the teacher keep today\'s filters', () => {
  it('teacher: To check (N), Checked, All; no "Waiting"', async () => {
    setStore(fakeStore('T', { courseMembers: members, visibleHomework: S1_HOMEWORK }));
    await render(<HomeworkScreen />);
    expect(screen.getByText('To check (2)')).toBeTruthy();
    expect(screen.queryByText(/^Waiting \(/)).toBeNull();
    expect(screen.queryByText('My homework')).toBeNull();
  });

  it('mentor who is not a listener: no "My homework", no "Waiting"', async () => {
    setStore(fakeStore('N', { courseMembers: members, visibleHomework: S1_HOMEWORK }));
    await render(<HomeworkScreen />);
    expect(screen.getByText('To check (2)')).toBeTruthy();
    expect(screen.queryByText(/^Waiting \(/)).toBeNull();
    expect(screen.queryByText('My homework')).toBeNull();
  });

  // Changed by ARU-23: "My homework" became the Listener tab, where mentors do get "Waiting (N)".
  it('mentor who is a listener: Owner "To check (N)" excludes their own homework; own homework on Listener', async () => {
    const own = hw({ id: 'm1', courseId: 'A', studentId: 'M2', title: 'Mo sent this' });
    setStore(fakeStore('M2', { courseMembers: members, visibleHomework: [...S1_HOMEWORK, own] }));
    await render(<HomeworkScreen />);
    expect(screen.getByText('To check (2)')).toBeTruthy();
    expect(screen.queryByText(/^Waiting \(/)).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: 'Listener' }));
    expect(screen.getByText('Waiting (1)')).toBeTruthy();
  });
});
