// ARU-91: the Homework tab's Waiting / To check cards no longer show the "Waiting for check" badge (same HomeworkCard
// `showStatus` prop as ARU-90). The default HomeworkCard (and the details screen) keep it. UI only.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import HomeworkScreen from '@/app/(tabs)/homework';
import { HomeworkCard } from '@/components/HomeworkCard';
import type { Homework } from '@/lib/types';
import { formatDate } from '@/lib/theme';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOMEWORK: Homework[] = [
  hw({ id: 's1', courseId: 'A', studentId: 'S1', title: 'HW S1 waiting', photoUrl: 'p.jpg' }),
  hw({ id: 's2', courseId: 'A', studentId: 'S1', title: 'HW S1 checked', status: 'checked', checkedById: 'M' }),
  hw({ id: 'm1', courseId: 'A', studentId: 'M2', title: 'HW M2 waiting' }),
];
const members = [member('A', 'S1'), member('A', 'M2')];
const date = formatDate('2026-10-10T10:00:00.000Z');
const titles = () => screen.queryAllByText(/^HW /).map((t) => t.props.children);

beforeEach(() => jest.clearAllMocks());

it('AC1: student on Waiting: no badge; title, course, date and photo still shown; tap opens details', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: HOMEWORK.filter((h) => h.studentId === 'S1') }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Waiting (1)'));
  expect(titles()).toEqual(['HW S1 waiting']);
  expect(screen.queryByText('Waiting for check')).toBeNull();
  expect(screen.getByText('Algebra')).toBeTruthy();
  expect(screen.getByText(`${date} · 📎 photo`)).toBeTruthy();
  await fireEvent.press(screen.getByText('HW S1 waiting'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/homework/[id]', params: { id: 's1' } });
});

it('AC1: mentor on Listener → Waiting: no badge', async () => {
  setStore(fakeStore('M2', { courseMembers: members, visibleHomework: HOMEWORK }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByRole('tab', { name: /^Listener/ }));
  await fireEvent.press(screen.getByText('Waiting (1)'));
  expect(titles()).toEqual(['HW M2 waiting']);
  expect(screen.queryByText('Waiting for check')).toBeNull();
});

it.each(['M2', 'T'] as const)('AC2: %s on To check: no badge; sender name and date still shown', async (who) => {
  setStore(fakeStore(who, { courseMembers: members, visibleHomework: HOMEWORK }));
  await render(<HomeworkScreen />);
  expect(screen.getByText(/^To check \(/)).toBeTruthy();
  expect(titles()).toContain('HW S1 waiting');
  expect(screen.queryByText('Waiting for check')).toBeNull();
  expect(screen.getByText(`Student Sam · ${date} · 📎 photo`)).toBeTruthy();
});

it('AC6: no status badge anywhere on the Homework tab (Checked shows the ARU-90 comment line)', async () => {
  setStore(fakeStore('T', { courseMembers: members, visibleHomework: HOMEWORK }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Checked'));
  expect(screen.getAllByText('Checked')).toHaveLength(1); // the filter tab only
  expect(screen.queryByText('Waiting for check')).toBeNull();
});

it('AC5/AC7: HomeworkCard with default props still shows "Waiting for check"', async () => {
  setStore(fakeStore('S1'));
  await render(<HomeworkCard item={HOMEWORK[0]} />);
  expect(screen.getByText('Waiting for check')).toBeTruthy();
});
