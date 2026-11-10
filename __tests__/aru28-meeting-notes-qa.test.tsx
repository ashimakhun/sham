// ARU-28 QA additions to aru28-meeting-notes.test.tsx (post-merge), from the TEST DESIGN: a meeting moving from
// Upcoming to History while the screen is open, toolbar toggles off (italic, numbered list), links that aren't
// http/https, a toolbar edit that would pass the limit, "Keep editing", the former owner after a handover, lists and
// links in the read view, and Notes for a student listener. Course A owned by mentor M; S1 a student listener of A.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router, usePreventRemove } from 'expo-router';
import { Alert } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import { insertLink, notesCounter } from '@/lib/markdown';
import type { Meeting, MeetingListenerNote } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24 * HOUR),
  topic: `Topic ${over.id}`,
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-100 * HOUR),
  ...over,
});
const C = meeting({ id: 'C', startsAt: at(-30 * HOUR), status: 'completed', topic: 'Done' });
const members = [member('A', 'S1')];
const notes = () => screen.getByLabelText('Notes');
const select = (start: number, end: number) =>
  fireEvent(notes(), 'selectionChange', { nativeEvent: { selection: { start, end } } });
const tool = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const headings = () => screen.queryAllByRole('header').map((h) => h.props.children);
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
  params.edit = undefined;
});

// ARU-60 replaced the Upcoming / History groups (a started meeting is In progress, a completed one Awaiting homework
// check); updated with the product owner's approval, keeping what this checks: the move needs no new data.
// ARU-88: headings are uppercase with the group's count, and the group View is the heading's direct parent.
describe('AC1: Upcoming and History while the screen is open', () => {
  afterEach(() => jest.useRealTimers());

  it('a meeting moves from Upcoming to In progress (ARU-60) once it starts, without new data', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T10:00:00.000Z') });
    const soon = meeting({ id: 'S', startsAt: '2026-10-30T10:00:20.000Z', topic: 'Starts soon' });
    setStore(fakeStore('S1', { courseMembers: members, meetings: [soon, C] }));
    await render(<CourseDetailScreen />);
    expect(headings()).toEqual(['UPCOMING (1)', 'AWAITING HOMEWORK CHECK (1)']);
    const upcomingCard = () => within(screen.getByText('UPCOMING (1)').parent!);
    // ARU-129: the tile is found by its testID; it is titled by its date and time, not the topic.
    expect(upcomingCard().getByTestId('meeting-S')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    // Nothing is upcoming any more: the heading is hidden and the meeting is In progress.
    expect(headings()).toEqual(['IN PROGRESS (1)', 'AWAITING HOMEWORK CHECK (1)']);
    expect(within(screen.getByText('IN PROGRESS (1)').parent!).getByTestId('meeting-S')).toBeTruthy();
    // ARU-88 AC 3: the started meeting's badge says In progress.
    expect(within(screen.getByTestId('meeting-S')).getByText('In progress')).toBeTruthy();
  });
});

describe('AC4: toolbar toggles off', () => {
  beforeEach(() => Object.assign(params, { meetingId: 'C', edit: '1' }));

  it('Italic on a selected word wraps it; tapping Italic again removes it', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    await fireEvent.changeText(notes(), 'read chapter one');
    await select(5, 12);
    await tool('Italic');
    expect(notes().props.value).toBe('read _chapter_ one');
    // The formatted text stays selected, so the second tap toggles it back.
    await tool('Italic');
    expect(notes().props.value).toBe('read chapter one');
  });

  it('Numbered list numbers every selected line and a second tap removes the numbers', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    await fireEvent.changeText(notes(), 'intro\nloops\nrecap');
    await select(0, 17);
    await tool('Numbered list');
    expect(notes().props.value).toBe('1. intro\n2. loops\n3. recap');
    await tool('Numbered list');
    expect(notes().props.value).toBe('intro\nloops\nrecap');
  });

  it('a toolbar edit that would pass 10,000 characters is refused and the text is unchanged', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    const full = 'a'.repeat(9_998);
    await fireEvent.changeText(notes(), full);
    await select(0, 5);
    await tool('Bold');
    expect(screen.getByText('Notes can be at most 10,000 characters.')).toBeTruthy();
    expect(notes().props.value).toBe(full);
  });
});

describe('AC4: links accept only http/https', () => {
  it.each(['ftp://files.example.com/a', 'javascript:alert(1)', 'example.com', 'mailto:a@b.c', ''])(
    'rejects %j',
    (url) => {
      expect(insertLink('docs', { start: 0, end: 4 }, url)).toEqual({
        error: 'Enter a web link starting with http:// or https://',
      });
    },
  );

  it('with only a cursor, inserts the URL as the link text', () => {
    expect(insertLink('see ', { start: 4, end: 4 }, ' https://x.io ')).toEqual({
      text: 'see [https://x.io](https://x.io)',
      selection: { start: 32, end: 32 },
    });
  });

  it('the editor offers no Link tool or Link URL field (ARU-64)', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    await fireEvent.changeText(notes(), 'files');
    await select(0, 5);
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull();
    expect(screen.queryByLabelText('Link URL')).toBeNull();
    expect(notes().props.value).toBe('files');
  });
});

describe('AC6: counter', () => {
  it('is hidden below 9,000 characters and shown from 9,000', () => {
    expect(notesCounter(8_999)).toBeNull();
    expect(notesCounter(9_000)).toBe('9,000 / 10,000');
    expect(notesCounter(10_000)).toBe('10,000 / 10,000');
  });
});

describe('edge: unsaved changes', () => {
  it('"Keep editing" keeps the text and does not leave', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<MeetingNotesScreen />);
    await fireEvent.changeText(notes(), 'half-written');
    const prevent = jest.mocked(usePreventRemove);
    const repeat = jest.fn();
    await act(async () => prevent.mock.lastCall![1]!({ data: { action: { type: 'GO_BACK' } }, repeat } as never));
    const keep = alert.mock.lastCall![2]!.find((b) => b.text === 'Keep editing')!;
    await act(async () => keep.onPress?.());
    expect(repeat).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(notes().props.value).toBe('half-written');
    alert.mockRestore();
  });
});

describe('AC7/AC9 and the owner change edge case', () => {
  // ARU-142: official notes are gone; the meeting's notes are the owner M's own entry.
  const withNotes = meeting({ id: 'CN', startsAt: at(-60 * HOUR), status: 'completed' });
  const mNote: MeetingListenerNote = {
    id: 'nM',
    meetingId: 'CN',
    courseId: 'A',
    authorId: 'M',
    body: '1. intro\n2. loops\n\nSee [the docs](https://docs.example.com)',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };

  it('the read view shows numbered lists and links formatted, never raw Markdown', async () => {
    Object.assign(params, { meetingId: 'CN' });
    setStore(fakeStore('S1', { courseMembers: members, meetings: [withNotes], meetingListenerNotes: [mNote] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.getByText('intro')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'the docs' })).toBeTruthy();
    expect(screen.queryByText(/\]\(|\*\*|^1\. intro/)).toBeNull();
    // ARU-142: a student listener reads M's note but can't edit or delete it.
    expect(screen.queryByRole('button', { name: /notes/i })).toBeNull();
  });

  // ARU-142: a listener now writes their own notes too: without a note of theirs the pencil says Add notes.
  it('a student listener sees the Notes link, and it opens the read view; their pencil is Add notes', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [withNotes], meetingListenerNotes: [mNote] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting('CN').queryByLabelText('Edit notes')).toBeNull();
    expect(inMeeting('CN').getByLabelText('Add notes')).toBeTruthy();
    await fireEvent.press(inMeeting('CN').getByLabelText('Notes'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params: { id: 'A', meetingId: 'CN' },
    });
  });

  // ARU-142: no «Last edited by» line. AC 6: the former owner M, now a mentor outside the course, no longer reads the
  // notes (the database sends M none), so M sees "No notes yet"; the new owner sees M's note signed by M (below).
  it('after a handover to N, the former owner M has no Notes or notes pencil and edit mode is refused', async () => {
    const handedOver = { ...courseA, createdById: 'N' };
    setStore(fakeStore('M', { courses: [handedOver], courseMembers: members, meetings: [withNotes] }));
    Object.assign(params, { meetingId: 'CN' });
    const view = await render(<MeetingNotesScreen />);
    expect(screen.getByText('No notes yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit notes' })).toBeNull();
    await view.unmount();
    const tile = await render(<CourseDetailScreen />);
    expect(inMeeting('CN').queryByLabelText(/^(Add|Edit) notes$|^Notes$/)).toBeNull();
    await tile.unmount();
    Object.assign(params, { edit: '1' });
    await render(<MeetingNotesScreen />);
    expect(screen.getByText("Only the course's listeners, its owner and the teacher can write notes.")).toBeTruthy();
  });

  // ARU-142: the pencil's label is about the viewer's own note; N has none yet, so it says Add notes.
  it('the new owner N gets the notes pencil (Add notes) on the same meeting, and M\'s note stays signed by M', async () => {
    const handedOver = { ...courseA, createdById: 'N' };
    const data = { courses: [handedOver], courseMembers: members, meetings: [withNotes], meetingListenerNotes: [mNote] };
    setStore(fakeStore('N', data));
    const tile = await render(<CourseDetailScreen />);
    expect(inMeeting('CN').getByLabelText('Add notes')).toBeTruthy();
    await tile.unmount();
    Object.assign(params, { meetingId: 'CN' });
    await render(<MeetingNotesScreen />);
    expect(within(screen.getByTestId('listener-note-nM')).getByText('Mentor Max')).toBeTruthy();
  });
});

describe('AC10: no notes actions outside completed meetings', () => {
  it('the teacher sees no Add notes on a future, a started-but-unmarked or a canceled meeting', async () => {
    const future = meeting({ id: 'F' });
    const started = meeting({ id: 'P', startsAt: at(-1 * HOUR) });
    const canceled = meeting({ id: 'X', startsAt: at(-5 * HOUR), status: 'canceled' });
    setStore(fakeStore('T', { courseMembers: members, meetings: [future, started, canceled] }));
    await render(<CourseDetailScreen />);
    for (const id of ['F', 'P', 'X']) {
      expect(inMeeting(id).queryByLabelText(/notes/i)).toBeNull();
    }
  });
});
