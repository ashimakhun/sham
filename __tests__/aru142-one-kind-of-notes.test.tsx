// ARU-142: one kind of meeting notes. Listeners, the course owner and the teacher write their own signed notes from
// one pencil (no text); the Notes page lists every note oldest first with no heading; a migrated note over 10,000
// characters is never cut and must be shortened before Save. Database rules: supabase/tests/aru142_one_kind_of_notes.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import { I18nContext, make } from '@/i18n/context';
import { isNotesWriter } from '@/lib/roles';
import { colors } from '@/lib/theme';
import type { Meeting, MeetingListenerNote } from '@/lib/types';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const C: Meeting = {
  id: 'C',
  courseId: 'A',
  startsAt: at(-20),
  topic: 'Done',
  status: 'completed',
  createdById: 'M',
  createdAt: at(-100),
};
const members = [member('A', 'S1'), member('A', 'M2')];
// Both times come from one Date.now(): two separate calls can land a millisecond apart, and the note then reads as
// edited (updatedAt > createdAt), which made the "Edited" count flaky.
const note = (id: string, authorId: string | null, body: string, created: number, updated = created): MeetingListenerNote => {
  const now = Date.now();
  return {
    id,
    meetingId: 'C',
    courseId: 'A',
    authorId,
    body,
    createdAt: new Date(now + created * HOUR).toISOString(),
    updatedAt: new Date(now + updated * HOUR).toISOString(),
    isPublic: true,
  };
};
const inMeeting = () => within(screen.getByTestId('meeting-C'));
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params) as (keyof typeof params)[]) delete params[k];
  Object.assign(params, { id: 'A' });
});

describe('AC 2: who writes', () => {
  it('a listener (student or mentor), the owner and the teacher; not a mentor outside the course or a student', () => {
    for (const who of ['S1', 'M2', 'M', 'T'] as const) expect(isNotesWriter(users[who], courseA, members)).toBe(true);
    for (const who of ['N', 'S2'] as const) expect(isNotesWriter(users[who], courseA, members)).toBe(false);
    expect(isNotesWriter(null, courseA, members)).toBe(false);
  });
});

describe('AC 3 / AC 11: one pencil on the tile', () => {
  it.each(['S1', 'M2', 'M', 'T'] as const)('%s: one icon-only pencil, "Add notes" before writing', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: [C] }));
    await render(<CourseDetailScreen />);
    const pencils = inMeeting().getAllByRole('button', { name: /notes/i });
    expect(pencils.map((p) => p.props.accessibilityLabel)).toEqual(['Add notes']);
    for (const text of ['Add notes', 'Edit notes', 'Add my notes', 'Edit my notes']) expect(screen.queryByText(text)).toBeNull();
    await fireEvent.press(pencils[0]);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params: { id: 'A', meetingId: 'C', edit: '1' },
    });
  });

  it('with my note the pencil is "Edit notes", next to the Notes link', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [note('n1', 'S1', 'Mine', -10)] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting().getByRole('link', { name: 'Notes' })).toBeTruthy();
    expect(inMeeting().getAllByRole('button', { name: /notes/i }).map((p) => p.props.accessibilityLabel)).toEqual(['Edit notes']);
  });

  it('in Russian the hidden label is «Добавить заметки», never shown', async () => {
    setStore(fakeStore('M', { courseMembers: members, meetings: [C] }));
    await render(ru(<CourseDetailScreen />));
    expect(inMeeting().getByRole('button', { name: 'Добавить заметки' })).toBeTruthy();
    expect(screen.queryByText('Добавить заметки')).toBeNull();
  });

  it('a mentor outside the course gets no pencil', async () => {
    setStore(fakeStore('N', { courseMembers: members, meetings: [C] }));
    await render(<CourseDetailScreen />);
    expect(inMeeting().queryByRole('button', { name: /notes/i })).toBeNull();
  });
});

describe('AC 7: the Notes page', () => {
  it('lists every note oldest first, with no heading; a deleted account signs as "Deleted account"', async () => {
    params.meetingId = 'C';
    const list = [note('a', 'M', 'From the owner', -18), note('b', null, 'From a gone account', -17), note('c', 'S1', 'From Sam', -16, -1)];
    setStore(fakeStore('T', { courseMembers: members, meetings: [C], meetingListenerNotes: list }));
    await render(<MeetingNotesScreen />);
    const box = within(screen.getByTestId('meeting-notes'));
    const cards = box.getAllByTestId(/^listener-note-/).map((n) => n.props.testID);
    expect(cards).toEqual(['listener-note-a', 'listener-note-b', 'listener-note-c']);
    for (const text of ['From the owner', 'From a gone account', 'From Sam']) expect(box.getByText(text)).toBeTruthy();
    expect(box.getByText('Deleted account')).toBeTruthy();
    expect(box.getAllByText(/^Edited /)).toHaveLength(1);
    expect(screen.queryByText(/listeners' notes/i)).toBeNull();
    expect(screen.queryByText(/Last edited by/)).toBeNull();
  });
});

describe('AC 5 / AC 9: the editor', () => {
  it('is titled "Notes" and saves my own notes', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    const store = fakeStore('T', { courseMembers: members, meetings: [C] });
    setStore(store);
    await render(<MeetingNotesScreen />);
    expect(screen.getByPlaceholderText('What was covered in this meeting?')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Covered fractions');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', 'Covered fractions', false);
  });

  it('a merged note over 10,000 characters is shown whole, can only shrink, and saves once it fits', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    const long = `${'a'.repeat(9000)}\n\n${'b'.repeat(9000)}`;
    const store = fakeStore('M', { courseMembers: members, meetings: [C], meetingListenerNotes: [note('m', 'M', long, -10)] });
    setStore(store);
    await render(<MeetingNotesScreen />);
    const field = () => screen.getByLabelText('Notes');
    expect(field().props.value).toBe(long);
    expect(field().props.maxLength).toBeGreaterThanOrEqual(long.length);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('18,002 / 10,000').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: colors.danger })]),
    );
    // Growing is refused, nothing is cut.
    await fireEvent.changeText(field(), `${long}!`);
    expect(field().props.value).toBe(long);
    // Shrinking is accepted, still over the limit: Save stays off.
    await fireEvent.changeText(field(), long.slice(0, 15000));
    expect(field().props.value).toHaveLength(15000);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await fireEvent.changeText(field(), 'a'.repeat(10000));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', 'a'.repeat(10000), true);
  });

  it('a mentor outside the course is told who can write', async () => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    setStore(fakeStore('N', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText("Only the course's listeners, its owner and the teacher can write notes.")).toBeTruthy();
  });
});
