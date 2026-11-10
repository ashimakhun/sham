// ARU-126: meeting tiles with icon pills (✓, ✕, pencil, people), Due on its own line, the theme-coloured bar for
// Awaiting homework check, shorter MEETING HISTORY tiles without Undo check, and the Notes page's header pencil.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, StyleSheet } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import { colors, formatDateTime } from '@/lib/theme';
import type { HomeworkAssignment, Meeting, MeetingListenerNote } from '@/lib/types';

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
const P = meeting({ id: 'P', startsAt: at(-1) });
const F = meeting({ id: 'F', startsAt: at(5) });
const C = meeting({ id: 'C', startsAt: at(-20), status: 'completed' });
const CN = meeting({ id: 'CN', startsAt: at(-22), status: 'completed' });
const K = meeting({ id: 'K', startsAt: at(-40), status: 'completed', homeworkCheckedAt: at(-30), homeworkCheckedById: 'T' });
// ARU-142: official notes are gone; CN's and K's notes are the owner M's own entries.
const mNote = (meetingId: string, body: string): MeetingListenerNote => ({
  id: `n-${meetingId}`,
  meetingId,
  courseId: 'A',
  authorId: 'M',
  body,
  createdAt: at(-19),
  updatedAt: at(-19),
  isPublic: true,
});
const notes = [mNote('CN', 'Covered'), mNote('K', 'Old')];
const asg = (meetingId: string, dueAt?: string): HomeworkAssignment => ({
  id: `a-${meetingId}`,
  meetingId,
  courseId: 'A',
  title: 'Write an essay about yourself and your goals for this course',
  description: '',
  createdById: 'M',
  createdAt: at(-19),
  dueAt,
});
const members = [member('A', 'S1')];

const flat = (s: unknown) => StyleSheet.flatten((typeof s === 'function' ? s({ pressed: false }) : s) as never) as Record<string, unknown>;
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const answer = (button: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === button)?.onPress?.());

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('Awaiting homework check (AC 1–3)', () => {
  it('AC 1: "Homework: <title>" (2 lines max), then Due on its own line', async () => {
    const due = at(48);
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], assignments: [asg('C', due)] }));
    await render(<CourseDetailScreen />);
    const title = inMeeting('C').getByText(/^Homework: Write an essay/);
    expect(title.props.numberOfLines).toBe(2);
    const dueLine = inMeeting('C').getByTestId('assignment-due-C');
    expect(dueLine.props.children).toBe(`Due ${formatDateTime(due)}`);
    expect(dueLine.props.numberOfLines).toBe(1);
    expect(screen.queryByText(/ · Due /)).toBeNull();
  });

  it('AC 1: no deadline reads "No deadline" on that line', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], assignments: [asg('C')] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('C').getByTestId('assignment-due-C').props.children).toBe('No deadline');
  });

  it('AC 2: a green ✓ with no text; confirming marks it checked, "Not now" does nothing', async () => {
    const store = fakeStore('T', { courseMembers: members, meetings: [C] });
    setStore(store);
    answer('Not now');
    await render(<CourseDetailScreen />);
    const check = inMeeting('C').getByRole('button', { name: 'Mark homework checked' });
    expect(within(check).queryByText(/./)).toBeNull();
    expect(flat(check.props.style)).toMatchObject({ backgroundColor: colors.successSoft, width: 30, borderRadius: 999 });
    await fireEvent.press(check);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(store.setMeetingHomeworkChecked).not.toHaveBeenCalled();
    answer('Mark checked');
    await fireEvent.press(check);
    await waitFor(() => expect(store.setMeetingHomeworkChecked).toHaveBeenCalledWith('C', true));
  });

  it.each(['S1'] as const)('AC 2: %s (a listener) gets no ✓', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: [C] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Mark homework checked' })).toBeNull();
  });

  it('AC 3: the awaiting-check bar is the theme colour; the other groups are unchanged', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings: [P, F, C, K] }));
    await render(<CourseDetailScreen />);
    const bar = (id: string) => flat(screen.getByTestId(`meeting-${id}`).props.style).borderLeftColor;
    expect(bar('C')).toBe(colors.primary);
    expect(bar('F')).toBe(colors.primary);
    expect(bar('P')).toBe(colors.success);
    expect(bar('K')).toBe(colors.border);
  });
});

describe('notes pencil on the tile (AC 5)', () => {
  it('owner: Notes, then a pencil labelled Edit notes; without notes, a pencil labelled Add notes', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [C, CN], meetingListenerNotes: notes }));
    await render(<CourseDetailScreen />);
    const edit = inMeeting('CN').getByRole('button', { name: 'Edit notes' });
    expect(within(edit).getByTestId('icon-create-outline')).toBeTruthy();
    expect(within(edit).queryByText(/./)).toBeNull();
    expect(inMeeting('CN').getByRole('link', { name: 'Notes' })).toBeTruthy();
    const labels = inMeeting('CN')
      .queryAllByRole(/button|link/)
      .map((b) => b.props.accessibilityLabel);
    expect(labels.slice(0, 2)).toEqual(['Notes', 'Edit notes']);
    await fireEvent.press(inMeeting('C').getByRole('button', { name: 'Add notes' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params: { id: 'A', meetingId: 'C', edit: '1' },
    });
  });

  // ARU-142: a listener writes their own notes with the same single pencil (no "Add my notes" text pill).
  it('a listener reads Notes and gets one pencil, labelled Add notes until they have a note', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [CN], meetingListenerNotes: notes }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('CN').getByRole('link', { name: 'Notes' })).toBeTruthy();
    const add = inMeeting('CN').getByRole('button', { name: 'Add notes' });
    expect(within(add).getByTestId('icon-create-outline')).toBeTruthy();
    expect(within(add).queryByText(/./)).toBeNull();
    expect(inMeeting('CN').getAllByTestId('icon-create-outline')).toHaveLength(1);
    expect(screen.queryByText(/my notes/i)).toBeNull();
  });

  // ARU-142 AC 6: a mentor outside the course no longer reads notes (the database sends none): no Notes, no pencil.
  it('a mentor outside the course gets neither Notes nor a pencil', async () => {
    setStore(fakeStore('N', { courseMembers: members, meetings: [CN] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('CN').queryByRole('link', { name: 'Notes' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Add|Edit) notes$/ })).toBeNull();
    // (Outside the tile N, a mentor, has the course's own edit pencils.)
    expect(inMeeting('CN').queryByTestId('icon-create-outline')).toBeNull();
  });
});

describe('MEETING HISTORY (AC 7, AC 8)', () => {
  it('no homework line, no "Homework checked by" line and no Undo check; Notes, pencil and count stay', async () => {
    const assignments = [asg('K', at(-35))];
    setStore(fakeStore('M', { courseMembers: members, meetings: [K], assignments, meetingListenerNotes: notes }));
    await render(<CourseDetailScreen />);
    const history = within(screen.getByTestId('meeting-history'));
    expect(history.queryByTestId('assignment-K')).toBeNull();
    expect(history.queryByText(/^Homework: /)).toBeNull();
    expect(history.queryByText(/Homework checked by/)).toBeNull();
    expect(history.queryByText(/Undo check/)).toBeNull();
    expect(history.queryAllByRole(/button|link/).map((b) => b.props.accessibilityLabel)).toEqual([
      'Notes',
      'Edit notes',
      'Attended 0 of 1',
    ]);
  });
});

describe('other actions as icons (AC 9–11)', () => {
  it('AC 10: Mark completed is a green ✓ with the same confirmation, and completes the meeting', async () => {
    const store = fakeStore('M', { courseMembers: members, meetings: [P] });
    setStore(store);
    const alert = answer('Mark completed');
    await render(<CourseDetailScreen />);
    const done = inMeeting('P').getByRole('button', { name: 'Mark completed' });
    expect(within(done).getByTestId('icon-checkmark').props.color).toBe(colors.success);
    await fireEvent.press(done);
    expect(alert.mock.calls[0][0]).toBe('Mark completed');
    await waitFor(() => expect(store.setMeetingStatus).toHaveBeenCalledWith('P', 'completed'));
  });

  it('AC 9: one red ✕ "Cancel meeting", last, on upcoming and in-progress meetings, with today\'s confirmation', async () => {
    const store = fakeStore('M', { courseMembers: members, meetings: [P, F] });
    setStore(store);
    const alert = answer('Mark canceled');
    await render(<CourseDetailScreen />);
    for (const id of ['P', 'F']) {
      const labels = inMeeting(id)
        .queryAllByRole(/button|link/)
        .map((b) => b.props.accessibilityLabel);
      expect(labels[labels.length - 1]).toBe('Cancel meeting');
      expect(inMeeting(id).queryByRole('button', { name: 'Mark canceled' })).toBeNull();
    }
    await fireEvent.press(inMeeting('P').getByRole('button', { name: 'Cancel meeting' }));
    expect(alert.mock.calls[0][1]).toMatch(/as canceled\?$/);
    await waitFor(() => expect(store.setMeetingStatus).toHaveBeenCalledWith('P', 'canceled'));
  });

  it('AC 11: Edit is a pencil labelled "Edit meeting" on scheduled meetings only', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [F, C] }));
    await render(<CourseDetailScreen />);
    const edit = inMeeting('F').getByRole('button', { name: 'Edit meeting' });
    expect(within(edit).getByTestId('icon-create-outline')).toBeTruthy();
    expect(inMeeting('C').queryByRole('button', { name: 'Edit meeting' })).toBeNull();
  });
});

describe('Notes page header pencil (AC 6)', () => {
  // Render the Stack header's headerRight, which the shared mock leaves out.
  const { Stack } = jest.requireMock('expo-router') as { Stack: { Screen: unknown } };
  const original = Stack.Screen;
  beforeAll(() => {
    Stack.Screen = ({ options }: { options?: { headerRight?: () => React.ReactNode } }) => options?.headerRight?.() ?? null;
  });
  afterAll(() => {
    Stack.Screen = original;
  });

  it('owner: no bottom button, a pencil in the header opens the editor', async () => {
    params.meetingId = 'CN';
    setStore(fakeStore('M', { courseMembers: members, meetings: [CN], meetingListenerNotes: notes }));
    await render(<MeetingNotesScreen />);
    const pencil = screen.getByTestId('notes-edit');
    expect(pencil.props.accessibilityLabel).toBe('Edit notes');
    expect(screen.getAllByRole('button', { name: 'Edit notes' })).toHaveLength(1);
    await fireEvent.press(pencil);
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params: { id: 'A', meetingId: 'CN', edit: '1' },
    });
  });

  // ARU-142: a listener writes notes too, so they get the pencil (Add notes: they have none yet).
  it('a listener gets the pencil labelled Add notes', async () => {
    params.meetingId = 'CN';
    setStore(fakeStore('S1', { courseMembers: members, meetings: [CN], meetingListenerNotes: notes }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByTestId('notes-edit').props.accessibilityLabel).toBe('Add notes');
  });

  // ARU-142 AC 6: N reads no notes (the database sends none).
  it('a mentor outside the course gets no pencil', async () => {
    params.meetingId = 'CN';
    setStore(fakeStore('N', { courseMembers: members, meetings: [CN] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText('No notes yet')).toBeTruthy();
    expect(screen.queryByTestId('notes-edit')).toBeNull();
  });

  it('not while the editor is open', async () => {
    params.meetingId = 'CN';
    params.edit = '1';
    try {
      setStore(fakeStore('M', { courseMembers: members, meetings: [CN], meetingListenerNotes: notes }));
      await act(async () => {
        await render(<MeetingNotesScreen />);
      });
      expect(screen.queryByTestId('notes-edit')).toBeNull();
    } finally {
      params.edit = undefined;
    }
  });
});
