// ARU-88: each meeting on course details is its own tile with a coloured left bar, the topic first, a badge that
// reads "In progress" once a Scheduled meeting has started, uppercase group headings with counts, and the actions as
// pills in a footer (red ones last). Course A owned by mentor M; S1 a student listener of A; teacher T.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { meetingAccent, meetingBadge } from '@/lib/meetings';
import { colors, formatDateTime } from '@/lib/theme';
import type { Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';
import { font } from '@/lib/fonts';

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
const C = meeting({ id: 'C', startsAt: at(-20), status: 'completed', topic: 'Done lesson' });
const K = meeting({ id: 'K', startsAt: at(-40), status: 'completed', topic: 'Checked', homeworkCheckedAt: at(-30), homeworkCheckedById: 'T' });
const X = meeting({ id: 'X', startsAt: at(-10), status: 'canceled', topic: 'Dropped' });
const all = [P, F, C, K, X];
const members = [member('A', 'S1')];

const flat = (s: unknown) => StyleSheet.flatten((typeof s === 'function' ? s({ pressed: false }) : s) as never);
const tileStyle = (id: string) => flat(screen.getByTestId(`meeting-${id}`).props.style);
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const headings = () => screen.getAllByRole('header').map((h) => [h.props.children].flat().join(''));
type Node = { props: Record<string, unknown>; children?: (Node | string)[] | null };
const texts = (n: Node | string): string[] =>
  typeof n === 'string' ? [n] : (n.children ?? []).flatMap((c) => texts(c as Node | string));
/** The footer's items in order: each pill's label (buttons and links) or its text (the "You attended" chip). */
const footerItems = (id: string) =>
  (screen.getByTestId(`actions-${id}`) as unknown as Node).children!.map((c) =>
    typeof c === 'string' ? c : ((c.props.accessibilityLabel as string) ?? texts(c).join('')),
  );

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('meetingBadge (AC 3, AC 11)', () => {
  const now = Date.now();
  it('a started Scheduled meeting reads In progress in success colours', () => {
    expect(meetingBadge(P, now)).toEqual({ label: 'In progress', bg: colors.successSoft, fg: colors.success });
  });
  it('a future Scheduled meeting reads Scheduled', () => {
    expect(meetingBadge(F, now)).toEqual({ label: 'Scheduled', bg: colors.primarySoft, fg: colors.primary });
  });
  it('the start time itself counts as started', () => {
    expect(meetingBadge({ status: 'scheduled', startsAt: new Date(now).toISOString() }, now).label).toBe('In progress');
  });
  it('Completed and Canceled keep their labels, even in the future', () => {
    expect(meetingBadge(C, now).label).toBe('Completed');
    expect(meetingBadge({ ...X, startsAt: at(5) }, now).label).toBe('Canceled');
  });
});

describe('tiles (AC 1, AC 2, AC 4, AC 8)', () => {
  it('every meeting, current or history, is its own outlined tile with a left bar in its group colour', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings: all }));
    await render(<CourseDetailScreen />);
    for (const id of ['P', 'F', 'C', 'K', 'X'])
      expect(tileStyle(id)).toMatchObject({
        backgroundColor: colors.bg,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 4,
        padding: 12,
      });
    expect(tileStyle('P').borderLeftColor).toBe(colors.success);
    expect(tileStyle('F').borderLeftColor).toBe(colors.primary);
    expect(tileStyle('C').borderLeftColor).toBe(colors.warning); // follows the group, though its badge says Completed
    expect(tileStyle('K').borderLeftColor).toBe(colors.border);
    expect(tileStyle('X').borderLeftColor).toBe(colors.border);
    expect(meetingAccent).toEqual({ inProgress: colors.success, upcoming: colors.primary, awaitingCheck: colors.warning, history: colors.border });
    // History tiles are inside MEETING HISTORY (same tile there).
    expect(within(screen.getByTestId('meeting-history')).getByTestId('meeting-K')).toBeTruthy();
  });

  it('a tile reads topic first (bold, 2 lines) with the badge, then the muted date and Rescheduled', async () => {
    const R = { ...F, rescheduledAt: at(-2) };
    setStore(fakeStore('S1', { courseMembers: members, meetings: [P, R] }));
    await render(<CourseDetailScreen />);
    const tile = screen.getByTestId('meeting-F') as unknown as Node;
    expect(texts(tile).slice(0, 2)).toEqual(['Future', 'Scheduled']);
    const topic = inMeeting('F').getByText('Future');
    expect(topic.props.numberOfLines).toBe(2);
    expect(flat(topic.props.style)).toMatchObject({ fontSize: 16, ...font(600) }); // ARU-119: 700 became Inter SemiBold 600
    const date = inMeeting('F').getByText(new RegExp(formatDateTime(F.startsAt).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(flat(date.props.style).color).toBe(colors.muted);
    expect(inMeeting('F').getByText('Rescheduled')).toBeTruthy();
    expect(flat(inMeeting('F').getByTestId('status-badge').props.style).flexShrink).toBe(0);
  });

  it('a started meeting shows In progress; it is still Scheduled in the data', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [P, F] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('P').getByText('In progress')).toBeTruthy();
    expect(inMeeting('P').queryByText('Scheduled')).toBeNull();
    expect(inMeeting('F').getByText('Scheduled')).toBeTruthy();
    expect(P.status).toBe('scheduled');
  });

  it('the badge switches live once the start passes', async () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      const soon = meeting({ id: 'SO', startsAt: new Date(Date.now() + 30 * 1000).toISOString() });
      setStore(fakeStore('S1', { courseMembers: members, meetings: [soon] }));
      await render(<CourseDetailScreen />);
      expect(inMeeting('SO').getByText('Scheduled')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(90 * 1000);
      });
      expect(inMeeting('SO').getByText('In progress')).toBeTruthy();
      expect(tileStyle('SO').borderLeftColor).toBe(colors.success);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('group headings (AC 5)', () => {
  it('uppercase muted labels with counts, headers for screen readers, extra space above each group', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [P, F, meeting({ id: 'F2', startsAt: at(8) }), C, X] }));
    await render(<CourseDetailScreen />);
    expect(headings()).toEqual(['IN PROGRESS (1)', 'UPCOMING (2)', 'AWAITING HOMEWORK CHECK (1)', 'MEETING HISTORY (1)']);
    const h = screen.getByText('UPCOMING (2)');
    expect(flat(h.props.style)).toMatchObject({ fontSize: 13, color: colors.muted });
    const group = h.parent as unknown as { props: { style: unknown } };
    const gs = flat(group.props.style);
    expect(gs.marginTop).toBe(8);
    expect(gs.gap).toBe(10);
  });
});

describe('footer (AC 6, AC 7, AC 9)', () => {
  it('owner on a started meeting: pills under a divider, Mark canceled last and red', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [P] }));
    await render(<CourseDetailScreen />);
    const footer = screen.getByTestId('actions-P');
    expect(flat(footer.props.style)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderTopWidth: 1, borderTopColor: colors.border });
    expect(footerItems('P')).toEqual(['Edit', 'Attended 0 of 1', 'Mark completed', 'Mark canceled']);
    const pill = screen.getByRole('button', { name: 'Edit' });
    expect(flat(pill.props.style)).toMatchObject({ backgroundColor: colors.primarySoft, borderRadius: 999 });
    expect(flat(inMeeting('P').getByText('Edit').props.style)).toMatchObject({ color: colors.primary, fontSize: 13, ...font(500) }); // ARU-119: 600 became Inter Medium 500
    const cancel = screen.getByRole('button', { name: 'Mark canceled' });
    expect(flat(cancel.props.style).backgroundColor).toBe('#FEF2F2');
    expect(flat(inMeeting('P').getByText('Mark canceled').props.style).color).toBe(colors.danger);
    // Tap target: about 30 pt pill + 8 pt slop above and below ≥ 44 pt.
    expect(flat(pill.props.style).minHeight + pill.props.hitSlop.top + pill.props.hitSlop.bottom).toBeGreaterThanOrEqual(44);
  });

  it('owner on an upcoming meeting: Edit, then Cancel meeting in red', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [F] }));
    await render(<CourseDetailScreen />);
    expect(footerItems('F')).toEqual(['Edit', 'Cancel meeting']);
    expect(flat(screen.getByRole('button', { name: 'Cancel meeting' }).props.style).backgroundColor).toBe('#FEF2F2');
  });

  it('listener who attended: a non-button "You attended" chip, then Undo in red and last', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [P], attendance: [{ meetingId: 'P', userId: 'S1', markedAt: at(0) }] as never }));
    await render(<CourseDetailScreen />);
    expect(footerItems('P')).toEqual(['✓ You attended', 'Undo attendance']);
    const chip = inMeeting('P').getByText('✓ You attended');
    expect(flat(chip.props.style).color).toBe(colors.success);
    expect((chip.parent as unknown as { props: Record<string, unknown> }).props.accessibilityRole).toBeUndefined();
    expect(flat(screen.getByRole('button', { name: 'Undo attendance' }).props.style).backgroundColor).toBe('#FEF2F2');
  });

  it('Undo check keeps the normal pill style', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings: [K] }));
    await render(<CourseDetailScreen />);
    expect(flat(screen.getByRole('button', { name: 'Undo check' }).props.style).backgroundColor).toBe(colors.primarySoft);
  });

  it('Attended count is a link pill that opens the attendance screen', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings: [C] }));
    await render(<CourseDetailScreen />);
    const link = screen.getByRole('link', { name: 'Attended 0 of 1' });
    expect(inMeeting('C').getByText('Attended: 0 of 1')).toBeTruthy();
    await fireEvent.press(link);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/attendance',
      params: { id: 'A', meetingId: 'C' },
    });
  });

  it('a meeting with no actions has no footer and no divider', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [F] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByTestId('actions-F')).toBeNull();
  });

  it('the tile is not one accessible element, so each action is reached on its own', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [P] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByTestId('meeting-P').props.accessible).toBeUndefined();
    for (const name of ['Edit', 'Mark completed', 'Mark canceled']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });
});
