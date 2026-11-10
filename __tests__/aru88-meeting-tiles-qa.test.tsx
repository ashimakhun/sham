// QA ARU-88: gaps in aru88-meeting-tiles.test.tsx: every pill's tap target is at least 44 pt tall (pill + hit slop),
// a long title wraps while the badge keeps its size (ARU-129: the title is the date and time), the teacher (not the owner) gets the same footer as
// the owner, a canceled meeting in MEETING HISTORY has a grey bar and a Canceled badge, a long location wraps to 2
// lines inside the tile, and the meeting testIDs stay unique per meeting.
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { colors, formatDateTime } from '@/lib/theme';
import type { Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24),
  topic: `Topic ${over.id}`,
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-100),
  ...over,
});
const P = meeting({ id: 'P', startsAt: at(-1), topic: 'Started' });
const F = meeting({ id: 'F', startsAt: at(5), topic: 'Future' });
const X = meeting({ id: 'X', startsAt: at(-10), status: 'canceled', topic: 'Dropped' });
const members = [member('A', 'S1')];
const flat = (s: unknown) => StyleSheet.flatten((typeof s === 'function' ? s({ pressed: false }) : s) as never) ?? {};

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

it('AC6: every action pill is at least 44 pt tall once its hit slop is counted', async () => {
  setStore(fakeStore('M', { courseMembers: members, meetings: [P, F] }));
  await render(<CourseDetailScreen />);
  const pills = [
    ...within(screen.getByTestId('actions-P')).getAllByRole('button'),
    ...within(screen.getByTestId('actions-F')).getAllByRole('button'),
  ];
  expect(pills.length).toBeGreaterThanOrEqual(4);
  for (const pill of pills) {
    const style = flat(pill.props.style) as { minHeight?: number };
    const slop = pill.props.hitSlop as { top?: number; bottom?: number } | undefined;
    expect((style.minHeight ?? 0) + (slop?.top ?? 0) + (slop?.bottom ?? 0)).toBeGreaterThanOrEqual(44);
  }
});

// ARU-129 replaced the topic title with the date and time; its edge case: a long title wraps (no line limit) and the
// badge on the right keeps its size. The old long topic is never shown.
it('AC4 edge (ARU-129): the date-and-time title wraps, the badge keeps its size, a long old topic is not shown', async () => {
  const long = meeting({ id: 'L', startsAt: at(3), topic: 'A very long meeting topic that goes on '.repeat(5).trim() });
  setStore(fakeStore('S1', { courseMembers: members, meetings: [long] }));
  await render(<CourseDetailScreen />);
  const tile = within(screen.getByTestId('meeting-L'));
  expect(tile.queryByText(long.topic)).toBeNull();
  const title = tile.getByText(formatDateTime(long.startsAt));
  expect(title.props.numberOfLines).toBeUndefined();
  expect((flat(title.props.style) as { flex?: number }).flex).toBe(1);
  const badge = tile.getByTestId('status-badge');
  expect((flat(badge.props.style) as { flexShrink?: number }).flexShrink).toBe(0);
  expect(tile.getByText('Scheduled')).toBeTruthy();
});

it('AC8: the teacher (not the owner) gets the same footer on a started meeting as the owner', async () => {
  const labels = () =>
    within(screen.getByTestId('actions-P'))
      .getAllByRole(/button|link/)
      .map((n) => n.props.accessibilityLabel);
  setStore(fakeStore('M', { courseMembers: members, meetings: [P] }));
  const owner = await render(<CourseDetailScreen />);
  const ownerLabels = labels();
  await owner.unmount();
  setStore(fakeStore('T', { courseMembers: members, meetings: [P] }));
  await render(<CourseDetailScreen />);
  expect(labels()).toEqual(ownerLabels);
  // ARU-126 AC 9: Mark canceled is now the ✕ "Cancel meeting", still the last pill.
  expect(ownerLabels[ownerLabels.length - 1]).toBe('Cancel meeting');
});

it('AC2/AC3: a canceled meeting in MEETING HISTORY has a grey bar and the Canceled badge', async () => {
  setStore(fakeStore('S1', { courseMembers: members, meetings: [X] }));
  await render(<CourseDetailScreen />);
  const history = within(screen.getByTestId('meeting-history'));
  const tile = history.getByTestId('meeting-X');
  expect((flat(tile.props.style) as { borderLeftColor?: string }).borderLeftColor).toBe(colors.border);
  expect(within(tile).getByText('Canceled')).toBeTruthy();
  expect(within(tile).queryByText('In progress')).toBeNull();
});

it('AC10 edge: a long location stays inside its tile (2 lines)', async () => {
  const loc = meeting({ id: 'Q', startsAt: at(2), location: 'Room 12, building B, '.repeat(8).trim() });
  setStore(fakeStore('S1', { courseMembers: members, meetings: [loc] }));
  await render(<CourseDetailScreen />);
  expect(within(screen.getByTestId('meeting-Q')).getByText(loc.location!).props.numberOfLines).toBe(2);
});

it('AC9: one tile per meeting, each with its own testID', async () => {
  setStore(fakeStore('T', { courseMembers: members, meetings: [P, F, X] }));
  await render(<CourseDetailScreen />);
  for (const id of ['P', 'F', 'X']) expect(screen.getAllByTestId(`meeting-${id}`)).toHaveLength(1);
});
