// ARU-125: meeting notes by listeners. Rules: supabase/tests/aru125_meeting_listener_notes.test.sql.
// Course A owned by mentor M; S1 a student listener and M2 a mentor listener; S2 a student who isn't; N another mentor.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import type { Meeting, MeetingListenerNote } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(-30),
  topic: `Topic ${over.id}`,
  status: 'completed',
  createdById: 'M',
  createdAt: at(-100),
  ...over,
});
const C = meeting({ id: 'C' });
const F = meeting({ id: 'F', startsAt: at(24), status: 'scheduled' });
const X = meeting({ id: 'X', startsAt: at(-5), status: 'canceled' });
const note = (over: Partial<MeetingListenerNote> & { id: string }): MeetingListenerNote => ({
  meetingId: 'C',
  courseId: 'A',
  authorId: 'S1',
  body: 'Sam **wrote**',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const samNote = note({ id: 'n1' });
const moNote = note({
  id: 'n2',
  authorId: 'M2',
  body: 'Mo wrote',
  createdAt: '2026-10-21T10:00:00.000Z',
  updatedAt: '2026-10-22T10:00:00.000Z',
});
const goneNote = note({ id: 'n3', authorId: null, body: 'Old notes', createdAt: '2026-10-23T10:00:00.000Z' });
const members = [member('A', 'S1'), member('A', 'M2')];
const labels = (id: string) =>
  within(screen.getByTestId(`meeting-${id}`))
    .queryAllByRole(/button|link/)
    .map((b) => b.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
  params.edit = undefined;
  params.mine = undefined;
});

describe('AC 1, 3, 5, 8: the meeting row', () => {
  it.each(['S1', 'M2'] as const)('%s (a listener) gets "Add my notes" on a completed meeting only', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: [C, F, X] }));
    await render(<CourseDetailScreen />);
    expect(labels('C')).toContain('Add my notes');
    expect(labels('C')).not.toContain('Notes');
    expect(labels('F')).not.toContain('Add my notes');
    await fireEvent.press(within(screen.getByTestId('meeting-C')).getByRole('button', { name: 'Add my notes' }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params: { id: 'A', meetingId: 'C', mine: '1' },
    });
  });

  it.each(['M', 'T', 'N'] as const)('%s (not a listener) gets no "Add my notes"', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: [C] }));
    await render(<CourseDetailScreen />);
    expect(labels('C')).not.toContain('Add my notes');
  });

  it('with my notes the action is "Edit my notes"; any listener note shows Notes', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [samNote] }));
    await render(<CourseDetailScreen />);
    expect(labels('C')).toEqual(expect.arrayContaining(['Notes', 'Edit my notes']));
    expect(labels('C')).not.toContain('Add my notes');
  });

  it('AC 8a: another listener\'s note appearing shows Notes without a refresh', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    const { rerender } = await render(<CourseDetailScreen />);
    expect(labels('C')).not.toContain('Notes');
    setStore(fakeStore('M', { courseMembers: members, meetings: [C], meetingListenerNotes: [moNote] }));
    await rerender(<CourseDetailScreen />);
    expect(labels('C')).toContain('Notes');
  });
});

describe('AC 6, 12: the Notes page', () => {
  it('shows LISTENERS\' NOTES oldest first with name, time, Edited and formatted text', async () => {
    params.meetingId = 'C';
    setStore(
      fakeStore('S2', {
        courseMembers: [...members, member('A', 'S2')],
        meetings: [{ ...C, notes: 'Owner notes', notesUpdatedById: 'M', notesUpdatedAt: '2026-10-19T10:00:00.000Z' }],
        meetingListenerNotes: [samNote, moNote, goneNote],
      }),
    );
    await render(<MeetingNotesScreen />);
    expect(screen.getByText('Owner notes')).toBeTruthy();
    const section = within(screen.getByTestId('listener-notes'));
    expect(section.getByText("LISTENERS' NOTES")).toBeTruthy();
    expect(section.getAllByText(/Student Sam|Mentor Mo|Deleted account/).map((e) => e.props.children)).toEqual([
      'Student Sam',
      'Mentor Mo',
      'Deleted account',
    ]);
    expect(within(screen.getByTestId('listener-note-n1')).queryByText(/^Edited/)).toBeNull();
    expect(within(screen.getByTestId('listener-note-n2')).getByText(/^Edited /)).toBeTruthy();
    expect(section.getByText('wrote')).toBeTruthy();
    // S2 is a listener without notes: no Delete on others' entries (they add theirs from the meeting row).
    expect(screen.queryByRole('button', { name: /notes/i })).toBeNull();
  });

  it('with only listener notes there is no "No notes yet"', async () => {
    params.meetingId = 'C';
    setStore(fakeStore('N', { courseMembers: members, meetings: [C], meetingListenerNotes: [samNote] }));
    await render(<MeetingNotesScreen />);
    expect(screen.queryByText('No notes yet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add my notes' })).toBeNull();
  });
});

describe('AC 4, 9: deleting', () => {
  it('the author deletes their own after "Delete your notes for this meeting?"', async () => {
    params.meetingId = 'C';
    const store = fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [samNote, moNote] });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    await render(<MeetingNotesScreen />);
    expect(screen.getAllByRole('button', { name: /Delete/ })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete notes' }));
    expect(alert).toHaveBeenCalledWith('Delete notes', 'Delete your notes for this meeting?', expect.any(Array), expect.anything());
    expect(store.deleteMeetingListenerNotes).toHaveBeenCalledWith('n1');
    alert.mockRestore();
  });

  it('Cancel keeps the note', async () => {
    params.meetingId = 'C';
    const store = fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [samNote] });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[0]?.onPress?.());
    await render(<MeetingNotesScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete notes' }));
    expect(store.deleteMeetingListenerNotes).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it.each(['M', 'T'] as const)('%s deletes anyone\'s notes with "Delete <name>\'s notes for this meeting?"', async (who) => {
    params.meetingId = 'C';
    const store = fakeStore(who, { courseMembers: members, meetings: [C], meetingListenerNotes: [samNote, moNote] });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    await render(<MeetingNotesScreen />);
    await fireEvent.press(screen.getByRole('button', { name: "Delete Mentor Mo's notes" }));
    expect(alert).toHaveBeenCalledWith(
      'Delete notes',
      "Delete Mentor Mo's notes for this meeting?",
      expect.any(Array),
      expect.anything(),
    );
    expect(store.deleteMeetingListenerNotes).toHaveBeenCalledWith('n2');
    // AC 9: no edit option for them.
    expect(screen.queryByRole('button', { name: /my notes/ })).toBeNull();
    alert.mockRestore();
  });

  it('another mentor can\'t delete', async () => {
    params.meetingId = 'C';
    setStore(fakeStore('N', { courseMembers: members, meetings: [C], meetingListenerNotes: [samNote] }));
    await render(<MeetingNotesScreen />);
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });
});

describe('AC 1-3: the editor', () => {
  it('adds notes; Save is disabled while blank', async () => {
    Object.assign(params, { meetingId: 'C', mine: '1' });
    const store = fakeStore('S1', { courseMembers: members, meetings: [C] });
    setStore(store);
    await render(<MeetingNotesScreen />);
    const input = screen.getByLabelText('Notes');
    expect(input.props.value).toBe('');
    expect(input.props.maxLength).toBe(10000);
    const saves = () => screen.getAllByRole('button', { name: /Save/ });
    expect(saves().every((b) => b.props.accessibilityState?.disabled)).toBe(true);
    await fireEvent.changeText(input, ' \t \n');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.saveMyMeetingNotes).not.toHaveBeenCalled();
    await fireEvent.changeText(input, '  My notes ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', '  My notes ');
    expect(router.back).toHaveBeenCalled();
  });

  it('opens my entry to edit it', async () => {
    Object.assign(params, { meetingId: 'C', mine: '1' });
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [samNote, moNote] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByLabelText('Notes').props.value).toBe('Sam **wrote**');
  });

  it('a failed save keeps the text and shows the error', async () => {
    Object.assign(params, { meetingId: 'C', mine: '1' });
    let fail: (e: Error) => void = () => {};
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        meetings: [C],
        saveMyMeetingNotes: jest.fn(() => new Promise<void>((_, reject) => (fail = reject))),
      }),
    );
    await render(<MeetingNotesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'draft');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await act(async () => fail(new Error('Network request failed')));
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(screen.getByLabelText('Notes').props.value).toBe('draft');
  });

  it.each([
    ['M', 'C', 'Only listeners of this course can add notes.'],
    ['S1', 'F', 'Notes can be added only to completed meetings.'],
  ] as const)('%s on %s is refused: %s', async (who, id, hint) => {
    Object.assign(params, { meetingId: id, mine: '1' });
    setStore(fakeStore(who, { courseMembers: members, meetings: [C, F] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText(hint)).toBeTruthy();
    expect(screen.queryByLabelText('Notes')).toBeNull();
  });
});
