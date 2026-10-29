// ARU-21 QA additions to aru21-waiting-label.test.tsx, following the TEST DESIGN: per-filter counts for a
// student, empty state on every student filter, the teacher's default "To check" selection, the exact order of
// a listener-mentor's four filters, and a large count.
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const FILTER = /^(Waiting \(\d+\)|To check \(\d+\)|Checked|All|My homework)$/;
const S1_HOMEWORK = [
  hw({ id: 'h1', courseId: 'A', title: 'Waiting one' }),
  hw({ id: 'h2', courseId: 'A', title: 'Waiting two' }),
  hw({ id: 'h3', courseId: 'A', title: 'Checked one', status: 'checked', checkedById: 'M' }),
];
const members = [member('A', 'S1'), member('A', 'M2')];
const titles = () => screen.queryAllByText(/^(Waiting one|Waiting two|Checked one|Mo sent this)$/).map((t) => t.props.children);

beforeEach(() => jest.clearAllMocks());

it('AC2: student filters list 2 / 1 / 3 items, and switching back to All shows everything again', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: S1_HOMEWORK }));
  await render(<HomeworkScreen />);
  expect(titles()).toHaveLength(3);
  await fireEvent.press(screen.getByText('Waiting (2)'));
  expect(titles()).toEqual(['Waiting one', 'Waiting two']);
  await fireEvent.press(screen.getAllByText('Checked')[0]);
  expect(titles()).toEqual(['Checked one']);
  await fireEvent.press(screen.getByText('All'));
  expect(titles()).toHaveLength(3);
  // The label stays "Waiting (2)" whichever filter is selected.
  expect(screen.getByText('Waiting (2)')).toBeTruthy();
});

it('AC5: a student with no homework sees the existing empty state on Waiting, Checked and All, never "To check"', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [] }));
  await render(<HomeworkScreen />);
  for (const f of ['Waiting (0)', 'Checked', 'All']) {
    await fireEvent.press(screen.getByText(f));
    expect(screen.getByText('No homework yet')).toBeTruthy();
    expect(screen.queryByText(/To check/)).toBeNull();
  }
});

it('edge: a large count still reads "Waiting (N)"', async () => {
  const many = Array.from({ length: 99 }, (_, i) => hw({ id: `w${i}`, courseId: 'A', title: `W${i}` }));
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: many }));
  await render(<HomeworkScreen />);
  expect(screen.getByText('Waiting (99)')).toBeTruthy();
});

it('AC6: the teacher opens on "To check" (only submitted homework listed), with To check, Checked, All in order', async () => {
  setStore(fakeStore('T', { courseMembers: members, visibleHomework: S1_HOMEWORK }));
  await render(<HomeworkScreen />);
  expect(screen.getAllByText(FILTER).slice(0, 3).map((t) => t.props.children)).toEqual(['To check (2)', 'Checked', 'All']);
  expect(titles()).toEqual(['Waiting one', 'Waiting two']);
});

it('AC6: a listener-mentor has exactly To check, Checked, All, My homework (in order) and opens on To check', async () => {
  const own = hw({ id: 'm1', courseId: 'A', studentId: 'M2', title: 'Mo sent this' });
  setStore(fakeStore('M2', { courseMembers: members, visibleHomework: [...S1_HOMEWORK, own] }));
  await render(<HomeworkScreen />);
  expect(screen.getAllByText(FILTER).slice(0, 4).map((t) => t.props.children)).toEqual([
    'To check (2)',
    'Checked',
    'All',
    'My homework',
  ]);
  expect(titles()).toEqual(['Waiting one', 'Waiting two']);
  await fireEvent.press(screen.getByText('My homework'));
  expect(titles()).toEqual(['Mo sent this']);
  expect(screen.queryByText(/^Waiting \(/)).toBeNull();
});
