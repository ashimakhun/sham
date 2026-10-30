// ARU-21 QA additions to aru21-waiting-label.test.tsx, following the TEST DESIGN: per-filter counts for a
// student, empty state on every student filter, the teacher's default "To check" selection, the exact order of
// a listener-mentor's four filters, and a large count.
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const FILTER = /^(New \(\d+\)|Waiting \(\d+\)|To check \(\d+\)|Checked|All|My homework)$/;
const S1_HOMEWORK = [
  hw({ id: 'h1', courseId: 'A', title: 'Waiting one' }),
  hw({ id: 'h2', courseId: 'A', title: 'Waiting two' }),
  hw({ id: 'h3', courseId: 'A', title: 'Checked one', status: 'checked', checkedById: 'M' }),
];
const members = [member('A', 'S1'), member('A', 'M2')];
const titles = () => screen.queryAllByText(/^(Waiting one|Waiting two|Checked one|Mo sent this)$/).map((t) => t.props.children);

beforeEach(() => jest.clearAllMocks());

// Changed by ARU-32: students get New / Waiting / Checked (default New) and no "All". What stays from ARU-21: the
// student's label is "Waiting (N)", never "To check", whichever filter is selected.
it('AC2: student filters list 0 (New) / 2 (Waiting) / 1 (Checked), and the label stays "Waiting (2)"', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: S1_HOMEWORK }));
  await render(<HomeworkScreen />);
  expect(titles()).toEqual([]); // New: sent homework is never listed there
  await fireEvent.press(screen.getByText('Waiting (2)'));
  expect(titles()).toEqual(['Waiting one', 'Waiting two']);
  await fireEvent.press(screen.getAllByText('Checked')[0]);
  expect(titles()).toEqual(['Checked one']);
  expect(screen.queryByText('All')).toBeNull();
  expect(screen.getByText('Waiting (2)')).toBeTruthy();
  expect(screen.queryByText(/To check/)).toBeNull();
});

it('AC5: a student with no homework sees an empty state on New, Waiting and Checked, never "To check"', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [] }));
  await render(<HomeworkScreen />);
  expect(screen.getByText('No new homework')).toBeTruthy();
  for (const f of ['Waiting (0)', 'Checked']) {
    await fireEvent.press(screen.getAllByText(f)[0]);
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

// Changed by ARU-23 (AC 8): the teacher has To check and Checked only, no "All".
it('AC6: the teacher opens on "To check" (only submitted homework listed), with To check, Checked in order', async () => {
  setStore(fakeStore('T', { courseMembers: members, visibleHomework: S1_HOMEWORK }));
  await render(<HomeworkScreen />);
  expect(screen.getAllByText(FILTER).slice(0, 2).map((t) => t.props.children)).toEqual(['To check (2)', 'Checked']);
  expect(screen.queryByText('All')).toBeNull();
  expect(titles()).toEqual(['Waiting one', 'Waiting two']);
});

// Changed by ARU-23 (AC 2, AC 4): Owner has To check / Checked; the mentor's own homework is on Listener.
// Changed by ARU-32: Listener opens on New; the mentor's sent homework is under Waiting.
it('AC6: a listener-mentor has exactly To check, Checked on Owner (opens on To check), own homework on Listener', async () => {
  const own = hw({ id: 'm1', courseId: 'A', studentId: 'M2', title: 'Mo sent this' });
  setStore(fakeStore('M2', { courseMembers: members, visibleHomework: [...S1_HOMEWORK, own] }));
  await render(<HomeworkScreen />);
  expect(screen.getAllByText(FILTER).slice(0, 2).map((t) => t.props.children)).toEqual(['To check (2)', 'Checked']);
  expect(screen.queryByText('All')).toBeNull();
  expect(titles()).toEqual(['Waiting one', 'Waiting two']);
  await fireEvent.press(screen.getByRole('tab', { name: 'Listener' }));
  expect(titles()).toEqual([]); // New
  await fireEvent.press(screen.getByText('Waiting (1)'));
  expect(titles()).toEqual(['Mo sent this']);
});
