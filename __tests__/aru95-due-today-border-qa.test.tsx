// QA ARU-95: gaps in aru95-due-today-border.test.tsx: the bordered card keeps the normal card's padding, radius and
// margins (AC 8, no layout shift beyond the 1 pt border), it gets no screen reader label that hides its text, the
// student's Waiting and Checked lists never show the red border even when the assignment is due today (AC 7), and
// going to Waiting and back to New keeps the border.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import { styles } from '@/components/ui';
import { colors } from '@/lib/theme';
import type { HomeworkAssignment, Meeting } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const local = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
const meeting = (id: string): Meeting => ({
  id,
  courseId: 'A',
  startsAt: local(1, 10),
  topic: 'Topic',
  status: 'completed',
  createdById: 'M',
  createdAt: local(1, 9),
});
const asg = (id: string, meetingId: string, dueAt?: string): HomeworkAssignment => ({
  id,
  meetingId,
  courseId: 'A',
  title: `Assignment ${id}`,
  description: '',
  createdById: 'M',
  createdAt: local(1, 12),
  dueAt,
});
const today = asg('today', 'C1', local(4, 20));
const sentToday = asg('sent', 'C2', local(4, 20));
const checkedToday = asg('done', 'C3', local(4, 20));

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

const open = async () => {
  setStore(
    fakeStore('S1', {
      courseMembers: [member('A', 'S1')],
      meetings: [meeting('C1'), meeting('C2'), meeting('C3')],
      assignments: [today, sentToday, checkedToday],
      visibleHomework: [
        hw({ id: 'h-sent', courseId: 'A', studentId: 'S1', title: 'Sent work', assignmentId: 'sent', status: 'submitted' }),
        hw({ id: 'h-done', courseId: 'A', studentId: 'S1', title: 'Checked work', assignmentId: 'done', status: 'checked' }),
      ],
    }),
  );
  await render(<HomeworkScreen />);
};

it('AC8: the bordered card keeps the card\'s padding, radius and margins; only the border width and colour change', async () => {
  await open();
  const card = screen.getByTestId('assignment-due-today-today');
  const s = StyleSheet.flatten(card.props.style);
  const base = StyleSheet.flatten(styles.card);
  expect(s).toEqual({ ...base, borderWidth: 1, borderColor: colors.danger });
});

it('accessibility: the bordered card has no label or role that would replace its text', async () => {
  await open();
  const card = screen.getByTestId('assignment-due-today-today');
  expect(card.props.accessibilityLabel).toBeUndefined();
  expect(card.props.accessible).not.toBe(true);
  expect(screen.getByText(/^Due /)).toBeTruthy();
});

it('AC7: the Waiting and Checked lists never show the red border, even for work due today', async () => {
  await open();
  await fireEvent.press(screen.getByRole('tab', { name: /^Waiting/ }));
  expect(screen.getByText('Sent work')).toBeTruthy();
  expect(screen.queryByTestId(/^assignment-due-today-/)).toBeNull();
  await fireEvent.press(screen.getByRole('tab', { name: /^Checked/ }));
  expect(screen.getByText('Checked work')).toBeTruthy();
  expect(screen.queryByTestId(/^assignment-due-today-/)).toBeNull();
});

it('going to Waiting and back to New keeps the border', async () => {
  await open();
  await fireEvent.press(screen.getByRole('tab', { name: /^Waiting/ }));
  await fireEvent.press(screen.getByRole('tab', { name: /^New/ }));
  expect(screen.getByTestId('assignment-due-today-today')).toBeTruthy();
  // Only the unsent assignment is in New.
  expect(screen.queryByText('Assignment sent')).toBeNull();
});
