// ARU-28: notes on completed meetings, Upcoming / History headings. Rules: supabase/tests/aru28_meeting_notes.test.sql.
// Course A owned by mentor M; N a mentor with no link; S1 a student listener of A; S2 a student who isn't.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router, usePreventRemove } from 'expo-router';
import { Alert, Linking } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import { MarkdownText } from '@/components/MarkdownText';
import { insertLink, notesCounter, parseMarkdown, toggleList, toggleWrap } from '@/lib/markdown';
import type { Meeting, MeetingListenerNote } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
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
const F1 = meeting({ id: 'F1', startsAt: at(48) });
const F2 = meeting({ id: 'F2', startsAt: at(2) });
const P = meeting({ id: 'P', startsAt: at(-1) });
const C = meeting({ id: 'C', startsAt: at(-30), status: 'completed', topic: 'Done' });
// ARU-142: official notes are gone; CN's notes are the owner M's own entry.
const CN = meeting({ id: 'CN', startsAt: at(-60), status: 'completed' });
const mNote: MeetingListenerNote = {
  id: 'nM',
  meetingId: 'CN',
  courseId: 'A',
  authorId: 'M',
  body: '**Covered** _ch 1_\n- one\n- two',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  isPublic: true,
};
const notes = [mNote];
const X = meeting({ id: 'X', startsAt: at(-5), status: 'canceled' });
const members = [member('A', 'S1')];
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const labels = (id: string) =>
  inMeeting(id)
    .queryAllByRole(/button|link/)
    .map((b) => b.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
  params.edit = undefined;
});

describe('markdown helpers', () => {
  it('parses bold, italic, lists and only web links', () => {
    expect(parseMarkdown('a **b** _c_ [d](https://x.io) [e](ftp://y)')).toEqual([
      {
        type: 'paragraph',
        lines: [
          [
            { type: 'text', text: 'a ' },
            { type: 'bold', children: [{ type: 'text', text: 'b' }] },
            { type: 'text', text: ' ' },
            { type: 'italic', children: [{ type: 'text', text: 'c' }] },
            { type: 'text', text: ' ' },
            { type: 'link', text: 'd', url: 'https://x.io' },
            { type: 'text', text: ' [e](ftp://y)' },
          ],
        ],
      },
    ]);
    expect(parseMarkdown('- a\n- b\n\n1. c\n2. d').map((b) => b.type)).toEqual(['bullets', 'numbers']);
  });

  it('bold and italic wrap a selection and a second tap removes them', () => {
    const on = toggleWrap('hello world', { start: 6, end: 11 }, '**');
    expect(on.text).toBe('hello **world**');
    expect(toggleWrap(on.text, on.selection, '**').text).toBe('hello world');
    expect(toggleWrap('hello **world**', { start: 6, end: 15 }, '**').text).toBe('hello world');
    expect(toggleWrap('hi', { start: 2, end: 2 }, '_')).toEqual({ text: 'hi__', selection: { start: 3, end: 3 } });
    // Several lines: each line wrapped separately, outside the list prefix.
    expect(toggleWrap('a\n- b', { start: 0, end: 5 }, '**').text).toBe('**a**\n- **b**');
  });

  it('lists toggle on every selected line and replace the other kind', () => {
    expect(toggleList('one', { start: 1, end: 1 }, 'bullets').text).toBe('- one');
    expect(toggleList('- one', { start: 3, end: 3 }, 'bullets').text).toBe('one');
    expect(toggleList('a\n\nb', { start: 0, end: 4 }, 'numbers').text).toBe('1. a\n\n2. b');
    expect(toggleList('1. a\n2. b', { start: 0, end: 9 }, 'bullets').text).toBe('- a\n- b');
  });

  it('links accept only http/https', () => {
    expect(insertLink('see docs', { start: 4, end: 8 }, 'https://x.io')).toMatchObject({
      text: 'see [docs](https://x.io)',
    });
    expect(insertLink('', { start: 0, end: 0 }, 'http://a.b')).toMatchObject({ text: '[http://a.b](http://a.b)' });
    for (const bad of ['ftp://x', 'javascript:alert(1)', 'plain text']) {
      expect(insertLink('x', { start: 0, end: 1 }, bad)).toHaveProperty('error');
    }
  });

  it('counter shows from 9,000 characters', () => {
    expect(notesCounter(8999)).toBeNull();
    expect(notesCounter(9250)).toBe('9,250 / 10,000');
  });
});

// ARU-60 replaced ARU-28's Upcoming / History groups: the top card has In progress, Upcoming and Awaiting homework
// check; canceled (and checked) meetings are in MEETING HISTORY at the bottom.
describe('AC1/AC2 (as changed by ARU-60): meeting groups', () => {
  it('groups in progress, upcoming (soonest first) and awaiting check (newest first); canceled goes to history', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C, F1, X, P, F2, CN] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('MEETINGS (5)')).toBeTruthy();
    const headers = screen.getAllByRole('header').map((h) => [h.props.children].flat().join(''));
    // ARU-88: uppercase headings with the group's count.
    expect(headers).toEqual(['IN PROGRESS (1)', 'UPCOMING (2)', 'AWAITING HOMEWORK CHECK (2)', 'MEETING HISTORY (1)']);
    const order = screen.getAllByTestId(/^meeting-[A-Z0-9]+$/).map((n) => n.props.testID);
    expect(order).toEqual(['meeting-P', 'meeting-F2', 'meeting-F1', 'meeting-C', 'meeting-CN', 'meeting-X']);
  });

  it('hides an empty group; "No meetings scheduled yet" without meetings', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C] }));
    const { rerender } = await render(<CourseDetailScreen />);
    expect(screen.getByText('AWAITING HOMEWORK CHECK (1)')).toBeTruthy();
    expect(screen.queryByText(/^UPCOMING/)).toBeNull();
    setStore(fakeStore('S1', { courseMembers: members, meetings: [] }));
    await rerender(<CourseDetailScreen />);
    expect(screen.getByText('No meetings scheduled yet')).toBeTruthy();
    expect(screen.queryByText(/^AWAITING HOMEWORK CHECK/)).toBeNull();
  });
});

describe('AC3/AC7/AC9/AC10: notes actions on completed meetings', () => {
  // ARU-142: the pencil says Edit notes only for the writer who has their own note on the meeting (M on CN).
  it.each([
    ['M', 'Edit notes'],
    ['T', 'Add notes'],
  ] as const)('%s sees Add notes / Edit notes on completed meetings only (CN: %s)', async (who, onCN) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: [F1, P, C, CN, X], meetingListenerNotes: notes }));
    await render(<CourseDetailScreen />);
    // + ARU-32, + ARU-33, + ARU-60
    expect(labels('C')).toEqual(['Add notes', 'Assign homework', 'Attended 0 of 1', 'Mark homework checked']);
    expect(labels('CN')).toEqual(['Notes', onCN, 'Assign homework', 'Attended 0 of 1', 'Mark homework checked']);
    expect(labels('X')).toEqual([]);
    expect(labels('F1')).not.toContain('Add notes');
    expect(labels('P')).not.toContain('Add notes');
    await fireEvent.press(inMeeting('C').getByRole('button', { name: 'Add notes' }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params: { id: 'A', meetingId: 'C', edit: '1' },
    });
  });

  // ARU-33: S1 (a listener) "I attended". ARU-142: S1 writes notes too, with the same single pencil.
  it('S1 reads notes and gets the pencil', async () => {
    const others = ['Add notes', 'I attended'];
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C, CN], meetingListenerNotes: notes }));
    await render(<CourseDetailScreen />);
    expect(labels('C')).toEqual(others);
    expect(labels('CN')).toEqual(['Notes', ...others]);
    await fireEvent.press(inMeeting('CN').getByRole('link', { name: 'Notes' }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params: { id: 'A', meetingId: 'CN' },
    });
  });

  // ARU-33: N (a mentor who isn't a listener) sees the attendance count; ARU-60: N may mark the homework checked.
  // ARU-142 AC 6: N no longer reads notes (the database sends N none), so N gets neither Notes nor a pencil.
  it('N (a mentor outside the course) gets neither Notes nor a pencil', async () => {
    setStore(fakeStore('N', { courseMembers: members, meetings: [C, CN] }));
    await render(<CourseDetailScreen />);
    expect(labels('C')).toEqual(['Attended 0 of 1', 'Mark homework checked']);
    expect(labels('CN')).toEqual(['Attended 0 of 1', 'Mark homework checked']);
  });

  it('AC8: notes saved elsewhere appear on the next store update', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C] }));
    const { rerender } = await render(<CourseDetailScreen />);
    expect(labels('C')).toEqual(['Add notes', 'I attended']); // ARU-33, ARU-142
    const newNote = { ...mNote, meetingId: 'C' };
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [newNote] }));
    await rerender(<CourseDetailScreen />);
    expect(labels('C')).toEqual(['Notes', 'Add notes', 'I attended']);
  });
});

describe('AC7: reading notes', () => {
  // ARU-142: no «Last edited by» line any more; each note is signed by its author.
  it('shows notes formatted, never raw Markdown, signed by the author', async () => {
    params.meetingId = 'CN';
    setStore(fakeStore('S1', { courseMembers: members, meetings: [CN], meetingListenerNotes: notes }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText('Covered')).toBeTruthy();
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(within(screen.getByTestId('listener-note-nM')).getByText('Mentor Max')).toBeTruthy();
    expect(screen.queryByText(/Last edited by/)).toBeNull();
    // ARU-142: S1 can't change or delete someone else's note.
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('links open in the browser', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    await render(<MarkdownText source="see [docs](https://x.io)" />);
    await fireEvent.press(screen.getByRole('link', { name: 'docs' }));
    expect(open).toHaveBeenCalledWith('https://x.io');
  });

  it('the owner with their own note sees Edit notes, which replaces the view with the editor', async () => {
    // ARU-126 AC 6: the pencil is in the header's right; render the Stack header's headerRight for this test.
    const { Stack } = jest.requireMock('expo-router') as { Stack: { Screen: unknown } };
    const original = Stack.Screen;
    Stack.Screen = ({ options }: { options?: { headerRight?: () => React.ReactNode } }) => options?.headerRight?.() ?? null;
    try {
      params.meetingId = 'CN';
      setStore(fakeStore('M', { courseMembers: members, meetings: [CN], meetingListenerNotes: notes }));
      await render(<MeetingNotesScreen />);
      await fireEvent.press(screen.getByRole('button', { name: 'Edit notes' }));
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/courses/[id]/meetings/[meetingId]/notes',
        params: { id: 'A', meetingId: 'CN', edit: '1' },
      });
    } finally {
      Stack.Screen = original;
    }
  });

  it('a meeting the user can no longer see shows "Meeting not found"', async () => {
    params.meetingId = 'CN';
    setStore(fakeStore('S2', { courseMembers: members, meetings: [CN] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText('Meeting not found')).toBeTruthy();
  });
});

describe('AC9/AC10: edit mode guards', () => {
  it('N (a mentor outside the course) opening edit mode sees the not-allowed message', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    setStore(fakeStore('N', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.getByText("Only the course's listeners, its owner and the teacher can write notes.")).toBeTruthy();
    expect(screen.queryByLabelText('Notes')).toBeNull();
  });

  // ARU-142: a listener writes notes now, so S1 gets the editor instead of the not-allowed message.
  it('S1 (a listener) opening edit mode gets the editor', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByLabelText('Notes')).toBeTruthy();
    expect(screen.queryByText('Not allowed')).toBeNull();
  });

  it('a canceled meeting cannot get notes', async () => {
    Object.assign(params, { meetingId: 'X', edit: '1' });
    setStore(fakeStore('M', { courseMembers: members, meetings: [X] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText('Notes can be added only to completed meetings.')).toBeTruthy();
  });
});

describe('AC3-AC6: editor', () => {
  it('prefills, formats with the toolbar, saves and goes back', async () => {
    Object.assign(params, { meetingId: 'CN', edit: '1' });
    const store = fakeStore('M', { courseMembers: members, meetings: [CN], meetingListenerNotes: notes });
    setStore(store);
    await render(<MeetingNotesScreen />);
    const input = screen.getByLabelText('Notes');
    expect(input.props.value).toBe(mNote.body);
    await fireEvent.changeText(input, 'hello');
    await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 5 } } });
    await fireEvent.press(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByLabelText('Notes').props.value).toBe('**hello**');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('CN', '**hello**', true);
    expect(router.back).toHaveBeenCalled();
  });

  it('has no Link tool; a hand-typed link is kept as plain text (ARU-64)', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Notes'), '[docs](https://x.io)');
    expect(screen.queryByLabelText('Link URL')).toBeNull();
    expect(screen.getByLabelText('Notes').props.value).toBe('[docs](https://x.io)');
  });

  it('a failed save keeps the text and shows the error; double tap saves once', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    let fail: (e: Error) => void = () => {};
    const store = fakeStore('M', {
      courseMembers: members,
      meetings: [C],
      saveMyMeetingNotes: jest.fn(() => new Promise<void>((_, reject) => (fail = reject))),
    });
    setStore(store);
    await render(<MeetingNotesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'draft');
    const save = screen.getByRole('button', { name: 'Save' });
    await fireEvent.press(save);
    await fireEvent.press(save);
    expect(store.saveMyMeetingNotes).toHaveBeenCalledTimes(1);
    await act(async () => fail(new Error('Network request failed')));
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(screen.getByLabelText('Notes').props.value).toBe('draft');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('the editor blocks typing past 10,000 characters and shows a counter near the limit', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByLabelText('Notes').props.maxLength).toBe(10000);
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'a'.repeat(9250));
    expect(screen.getByText('9,250 / 10,000')).toBeTruthy();
  });

  it('leaving with unsaved changes asks "Discard changes?"', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<MeetingNotesScreen />);
    const prevent = jest.mocked(usePreventRemove);
    expect(prevent).toHaveBeenLastCalledWith(false, expect.any(Function));
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'draft');
    expect(prevent).toHaveBeenLastCalledWith(true, expect.any(Function));
    const repeat = jest.fn();
    await act(async () => prevent.mock.lastCall![1]!({ data: { action: { type: 'GO_BACK' } }, repeat } as never));
    expect(alert).toHaveBeenCalledWith('Discard changes?', expect.any(String), expect.any(Array), expect.any(Object));
    const discard = alert.mock.lastCall![2]!.find((b) => b.text === 'Discard')!;
    await act(async () => discard.onPress!());
    expect(repeat).toHaveBeenCalled();
  });
});
