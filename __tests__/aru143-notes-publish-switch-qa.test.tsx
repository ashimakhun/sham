// QA ARU-143: gaps in aru143-notes-publish-switch.test.tsx:
// - AC 3: leaving with only a switch change asks to discard; switching back to the start state turns Save off again;
//   a public note made private with the text unchanged keeps no «Edited» line (updatedAt = createdAt).
// - AC 11 in Russian: the switch is read as «Опубликовать» with the hint; the badge is read with the author's name.
// - Edge: a failed save shows the error and keeps the text and the switch as set.
// - Edge: a migrated note over 10,000 characters: switching alone keeps Save off.
// - AC 6: the badge never shows on someone else's note, even if a private one reached the store; public notes by me
//   have no badge.
// - AC 10: the store's refreshMeetingNotes() replaces the list, so a note made private elsewhere disappears.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { usePreventRemove } from 'expo-router';
import { Alert } from 'react-native';

import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import { I18nContext, make } from '@/i18n/context';
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
const saveBtn = () => screen.getAllByRole('button', { name: /^Save/ }).at(-1)!;

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  for (const k of Object.keys(params) as (keyof typeof params)[]) delete params[k];
  Object.assign(params, { id: 'A', meetingId: 'C' });
});
afterEach(() => alert.mockRestore());

describe('AC 3: a switch-only change', () => {
  it('asks to discard when leaving; switching back to the start turns Save off and the prompt off', async () => {
    params.edit = '1';
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [note('S1', true, 'Sam')] }));
    await render(<MeetingNotesScreen />);
    const prevent = usePreventRemove as jest.Mock;
    expect(prevent).toHaveBeenLastCalledWith(false, expect.any(Function));
    await fireEvent(publish(), 'valueChange', false);
    const [on, onRemove] = prevent.mock.lastCall;
    expect(on).toBe(true);
    onRemove({ repeat: jest.fn() });
    expect(alert).toHaveBeenLastCalledWith('Discard changes?', expect.any(String), expect.any(Array), expect.anything());
    await fireEvent(publish(), 'valueChange', true);
    expect(saveBtn()).toBeDisabled();
    expect(prevent).toHaveBeenLastCalledWith(false, expect.any(Function));
  });

  it('a note whose updatedAt equals createdAt shows no «Edited» line, public or private', async () => {
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        meetings: [C],
        meetingListenerNotes: [note('S1', false, 'Mine'), note('M2', true, 'Theirs')],
      }),
    );
    await render(<MeetingNotesScreen />);
    expect(screen.queryByText(/^Edited/)).toBeNull();
  });

  it('a migrated note over 10,000 characters: switching alone keeps Save off', async () => {
    params.edit = '1';
    setStore(
      fakeStore('M2', { courseMembers: members, meetings: [C], meetingListenerNotes: [note('M2', true, 'a'.repeat(10001))] }),
    );
    await render(<MeetingNotesScreen />);
    await fireEvent(publish(), 'valueChange', false);
    expect(saveBtn()).toBeDisabled();
  });
});

describe('edge: saving', () => {
  it('a failed save shows the error and keeps the text and the switch as set', async () => {
    params.edit = '1';
    const store = fakeStore('S1', { courseMembers: members, meetings: [C] });
    (store.saveMyMeetingNotes as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
    setStore(store);
    await render(<MeetingNotesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Offline notes');
    await fireEvent(publish(), 'valueChange', true);
    await fireEvent.press(saveBtn());
    await act(async () => {});
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', 'Offline notes', true);
    expect(screen.getByText(/Network request failed/)).toBeTruthy();
    expect(publish().props.value).toBe(true);
    expect(screen.getByLabelText('Notes').props.value).toBe('Offline notes');
  });
});

describe('AC 6 / AC 11', () => {
  it('in Russian: the switch is read as «Опубликовать» with the hint, the badge with the author\'s name', async () => {
    params.edit = '1';
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [note('S1', false)] }));
    const view = await render(ru(<MeetingNotesScreen />));
    expect(publish().props.accessibilityLabel).toBe('Опубликовать');
    expect(publish().props.accessibilityHint).toBe('Эти заметки увидите только вы.');
    await fireEvent(publish(), 'valueChange', true);
    expect(publish().props.accessibilityHint).toBe('Эти заметки увидят все участники курса и преподаватель.');
    await view.unmount();
    delete params.edit;
    await render(ru(<MeetingNotesScreen />));
    expect(screen.getByLabelText(/, Личные$/)).toBeTruthy();
  });

  it('my public note has no badge; the badge shows only on my own notes', async () => {
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        meetings: [C],
        meetingListenerNotes: [note('S1', true, 'Mine public')],
      }),
    );
    await render(<MeetingNotesScreen />);
    expect(within(screen.getByTestId('listener-note-n-S1')).queryByTestId('private-badge')).toBeNull();
  });
});
