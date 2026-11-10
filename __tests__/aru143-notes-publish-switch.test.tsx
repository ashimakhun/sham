// ARU-143: the Publish switch on meeting notes, the "Private" badge, and the notes refetch when the Notes screen or
// the course opens. Database rules: supabase/tests/aru143_notes_publish_switch.test.sql.
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import { I18nContext, make } from '@/i18n/context';
import { colors } from '@/lib/theme';
import type { Meeting, MeetingListenerNote } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
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
const note = (authorId: string, isPublic: boolean, body = `${authorId}'s notes`): MeetingListenerNote => ({
  id: `n-${authorId}`,
  meetingId: 'C',
  courseId: 'A',
  authorId,
  body,
  createdAt: at(-10),
  updatedAt: at(-10),
  isPublic,
});
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const publish = () => screen.getByTestId('notes-publish');
const save = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params) as (keyof typeof params)[]) delete params[k];
  Object.assign(params, { id: 'A', meetingId: 'C' });
});

describe('AC 1: the switch in the editor', () => {
  it('a new note: off, with the private hint; on shows the public hint and saves published', async () => {
    params.edit = '1';
    const store = fakeStore('S1', { courseMembers: members, meetings: [C] });
    setStore(store);
    await render(<MeetingNotesScreen />);
    expect(publish().props.value).toBe(false);
    expect(publish().props.accessibilityLabel).toBe('Publish');
    expect(screen.getByText('Only you will see these notes.')).toBeTruthy();
    // The app's indigo switch (ARU-116).
    expect(publish().props.onTintColor).toBe(colors.primary);
    await fireEvent(publish(), 'valueChange', true);
    expect(screen.getByText('Everyone in the course and the teacher will see these notes.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Covered fractions');
    await fireEvent.press(save());
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', 'Covered fractions', true);
  });

  it('a new note saved without touching the switch is private', async () => {
    params.edit = '1';
    const store = fakeStore('T', { courseMembers: members, meetings: [C] });
    setStore(store);
    await render(<MeetingNotesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Mine only');
    await fireEvent.press(save());
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', 'Mine only', false);
  });

  it('in Russian: «Опубликовать» and its hints', async () => {
    params.edit = '1';
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C] }));
    await render(ru(<MeetingNotesScreen />));
    expect(screen.getByText('Опубликовать')).toBeTruthy();
    expect(screen.getByText('Эти заметки увидите только вы.')).toBeTruthy();
    await fireEvent(publish(), 'valueChange', true);
    expect(screen.getByText('Эти заметки увидят все участники курса и преподаватель.')).toBeTruthy();
  });
});

describe('AC 2 / AC 3: editing my note', () => {
  it('a public note opens with the switch on; nothing changed keeps Save off; the switch alone enables it', async () => {
    params.edit = '1';
    const store = fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [note('S1', true, 'Sam')] });
    setStore(store);
    await render(<MeetingNotesScreen />);
    expect(publish().props.value).toBe(true);
    expect(save()).toBeDisabled();
    await fireEvent(publish(), 'valueChange', false);
    expect(save()).toBeEnabled();
    await fireEvent.press(save());
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', 'Sam', false);
  });

  it('a private note opens with the switch off', async () => {
    params.edit = '1';
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [note('S1', false)] }));
    await render(<MeetingNotesScreen />);
    expect(publish().props.value).toBe(false);
  });
});

describe('AC 6: the Private badge', () => {
  it('shows on my own private note, read with my name; not on public notes', async () => {
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        meetings: [C],
        meetingListenerNotes: [note('S1', false, 'My secret'), note('M2', true, 'Shared')],
      }),
    );
    await render(<MeetingNotesScreen />);
    const mine = within(screen.getByTestId('listener-note-n-S1'));
    expect(mine.getByText('Private')).toBeTruthy();
    expect(mine.getByLabelText('Student Sam, Private')).toBeTruthy();
    expect(within(screen.getByTestId('listener-note-n-M2')).queryByText('Private')).toBeNull();
  });

  it('in Russian the badge is «Личные»', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [note('S1', false)] }));
    await render(ru(<MeetingNotesScreen />));
    expect(screen.getByText('Личные')).toBeTruthy();
  });
});

describe('AC 7 / AC 10: what the store holds is what shows; it is refetched on open', () => {
  it('my private note alone still shows the tile\'s Notes link for me', async () => {
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [note('S1', false)] }));
    await render(<CourseDetailScreen />);
    expect(within(screen.getByTestId('meeting-C')).getByRole('link', { name: 'Notes' })).toBeTruthy();
  });

  it('no notes I can read: no Notes link', async () => {
    setStore(fakeStore('M2', { courseMembers: members, meetings: [C], meetingListenerNotes: [] }));
    await render(<CourseDetailScreen />);
    expect(within(screen.getByTestId('meeting-C')).queryByRole('link', { name: 'Notes' })).toBeNull();
  });

  it('opening the course or the Notes screen refetches the notes', async () => {
    const store = fakeStore('T', { courseMembers: members, meetings: [C] });
    setStore(store);
    await render(<CourseDetailScreen />);
    expect(store.refreshMeetingNotes).toHaveBeenCalledTimes(1);
    await render(<MeetingNotesScreen />);
    expect(store.refreshMeetingNotes).toHaveBeenCalledTimes(2);
  });
});
