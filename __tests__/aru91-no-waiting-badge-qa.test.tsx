// QA ARU-91: gaps in aru91-no-waiting-badge.test.tsx: the details screen keeps "Waiting for check" (AC 4), the
// waiting card's last line is the date line (no empty gap where the badge was, AC 3), a long title still wraps to 2
// lines on a waiting card, and a homework checked while the list is open moves to Checked without any badge showing.
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import HomeworkDetailScreen from '@/app/homework/[id]';
import { formatDate } from '@/lib/theme';
import type { Homework } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const members = [member('A', 'S1')];
const waiting = hw({ id: 'w1', courseId: 'A', studentId: 'S1', title: 'HW waiting', photoUrl: 'p.jpg' });
const date = formatDate('2026-10-10T10:00:00.000Z');

beforeEach(() => jest.clearAllMocks());

it('AC4: the details screen still shows "Waiting for check"', async () => {
  params.id = 'w1';
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [waiting] }));
  await render(<HomeworkDetailScreen />);
  expect(screen.getByText('Waiting for check')).toBeTruthy();
});

it('AC3: a waiting card ends with its date line, with nothing empty after it', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [waiting] }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Waiting (1)'));
  const dateLine = screen.getByText(`${date} · 📎 photo`);
  const siblings = dateLine.parent!.children;
  expect(siblings[siblings.length - 1]).toBe(dateLine);
});

it('AC3 edge: a long title on a waiting card still wraps to 2 lines', async () => {
  const long = { ...waiting, title: 'HW ' + 'very long homework title '.repeat(6).trim() };
  setStore(fakeStore('T', { courseMembers: members, visibleHomework: [long] }));
  await render(<HomeworkScreen />);
  expect(screen.getByText(long.title).props.numberOfLines).toBe(2);
  expect(screen.queryByText('Waiting for check')).toBeNull();
});

it('edge: checked while the list is open, it leaves To check and no badge shows anywhere', async () => {
  setStore(fakeStore('T', { courseMembers: members, visibleHomework: [waiting] }));
  const view = await render(<HomeworkScreen />);
  expect(screen.getByText('HW waiting')).toBeTruthy();
  setStore(
    fakeStore('T', {
      courseMembers: members,
      visibleHomework: [{ ...waiting, status: 'checked', checkedById: 'M', mentorComment: 'Good' }],
    }),
  );
  await view.rerender(<HomeworkScreen />);
  expect(screen.queryByText('HW waiting')).toBeNull();
  await fireEvent.press(screen.getByText('Checked'));
  expect(screen.getByText('HW waiting')).toBeTruthy();
  expect(screen.queryByText('Waiting for check')).toBeNull();
  expect(screen.getAllByText('Checked')).toHaveLength(1);
});
