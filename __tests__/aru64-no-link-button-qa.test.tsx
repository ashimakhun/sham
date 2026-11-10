// QA ARU-64: gaps in aru64-no-link-button.test.tsx, on the real screens: Share material for the teacher and a mentor
// (four tools, no Link, the separate "Link (optional)" field kept, a hand-typed link sent as typed, the 10,000 limit
// on a toolbar edit), Edit notes with a saved link (raw markup in the field, a Bold edit elsewhere keeps it on Save),
// the notes view and the post screen still opening links, and the field height with the keyboard open no longer
// reserving room for the removed URL row.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Dimensions, Linking, StyleSheet } from 'react-native';

import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import MaterialDetailScreen from '@/app/materials/[id]';
import NewMaterialScreen from '@/app/materials/new';
import type { Material, Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
const mockKeyboard = { height: 0 };
jest.mock('@/lib/useKeyboardHeight', () => ({ useKeyboardHeight: () => mockKeyboard.height }));

const FOUR = ['Bold', 'Italic', 'Bulleted list', 'Numbered list'];
const LINKED = 'Read [docs](https://x.io) first';
const done: Meeting = {
  id: 'C',
  courseId: 'A',
  startsAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
  topic: 'Done',
  status: 'completed',
  createdById: 'M',
  createdAt: new Date(Date.now() - 100 * 3600_000).toISOString(),
};
// ARU-142: meeting notes are signed notes; `who` wrote this one.
const linkedNote = (who: string) => ({
  id: 'n1',
  meetingId: 'C',
  courseId: 'A',
  authorId: who,
  body: LINKED,
  createdAt: done.startsAt,
  updatedAt: done.startsAt,
});
const toolbar = () => within(screen.getByLabelText('Formatting')).getAllByRole('button').map((b) => b.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
  mockKeyboard.height = 0;
  for (const k of Object.keys(params) as (keyof typeof params)[]) delete params[k];
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
});

describe('AC 1 / AC 5: Share material', () => {
  it.each(['T', 'M'] as const)('%s: four tools in order, no Link, and the "Link (optional)" field is still there', async (who) => {
    setStore(fakeStore(who));
    await render(<NewMaterialScreen />);
    expect(toolbar()).toEqual(FOUR);
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull();
    expect(screen.getByText('Link (optional)')).toBeTruthy();
  });

  it('a link typed by hand in Content is shared as typed, next to the optional link', async () => {
    const store = fakeStore('T');
    setStore(store);
    await render(<NewMaterialScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Lesson 3: Decimals'), 'Week 1');
    await fireEvent.changeText(screen.getByLabelText('Content'), LINKED);
    await fireEvent.changeText(screen.getByPlaceholderText('https://…'), 'https://attached.io');
    await fireEvent.press(screen.getByRole('button', { name: 'Share with class' }));
    await waitFor(() =>
      expect(store.addMaterial).toHaveBeenCalledWith({ title: 'Week 1', body: LINKED, link: 'https://attached.io' }),
    );
  });

  it('AC 4: a toolbar edit that would pass 10,000 characters shows the Content message and changes nothing', async () => {
    setStore(fakeStore('M'));
    await render(<NewMaterialScreen />);
    const full = 'a'.repeat(9_998);
    const content = () => screen.getByLabelText('Content');
    await fireEvent.changeText(content(), full);
    await fireEvent(content(), 'selectionChange', { nativeEvent: { selection: { start: 0, end: 5 } } });
    await fireEvent.press(screen.getByRole('button', { name: 'Bold' })); // +4 characters: 10,002
    expect(screen.getByText('Content can be at most 10,000 characters.')).toBeTruthy();
    expect(content().props.value).toBe(full);
  });
});

describe('AC 2 / AC 5: meeting notes', () => {
  it.each(['M', 'T'] as const)('%s editing notes with a saved link: four tools, raw markup, and Save keeps it', async (who) => {
    Object.assign(params, { id: 'A', meetingId: 'C', edit: '1' });
    const store = fakeStore(who, { courseMembers: [member('A', 'S1')], meetings: [done], meetingListenerNotes: [linkedNote(who)] });
    setStore(store);
    await render(<MeetingNotesScreen />);
    expect(toolbar()).toEqual(FOUR);
    const field = screen.getByLabelText('Notes');
    expect(field.props.value).toBe(LINKED);
    // Bold "first" (the last word), away from the link.
    await fireEvent(field, 'selectionChange', { nativeEvent: { selection: { start: LINKED.length - 5, end: LINKED.length } } });
    await fireEvent.press(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByLabelText('Notes').props.value).toBe('Read [docs](https://x.io) **first**');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', 'Read [docs](https://x.io) **first**'));
  });

  it('a student listener reading the notes still sees and opens the link', async () => {
    Object.assign(params, { id: 'A', meetingId: 'C' });
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], meetings: [done], meetingListenerNotes: [linkedNote('M')] }));
    await render(<MeetingNotesScreen />);
    expect(screen.queryByLabelText('Formatting')).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: 'docs' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://x.io');
  });
});

it('AC 5: the post screen still shows and opens a saved link (student)', async () => {
  const post: Material = { id: 'P', teacherId: 'T', title: 'Post', body: LINKED, createdAt: '2026-11-01T10:00:00.000Z' };
  params.id = 'P';
  setStore(fakeStore('S1', { materials: [post] }));
  await render(<MaterialDetailScreen />);
  await fireEvent.press(screen.getByRole('link', { name: 'docs' }));
  expect(Linking.openURL).toHaveBeenCalledWith('https://x.io');
});

it('ARU-58 kept: with the keyboard open the field takes the room above it, no longer minus a link row', async () => {
  // Keyboard leaves the window minus 300 for header, toolbar and Save (OTHER_CONTENT); the 90-pt link row is no
  // longer subtracted. Pick a keyboard height that puts that room between the 96-pt minimum and the 40% cap.
  const win = Dimensions.get('window').height;
  const expected = Math.round(win * 0.4) - 20;
  mockKeyboard.height = win - 300 - expected;
  Object.assign(params, { id: 'A', meetingId: 'C', edit: '1' });
  setStore(fakeStore('M', { courseMembers: [member('A', 'S1')], meetings: [done] }));
  await render(<MeetingNotesScreen />);
  const style = StyleSheet.flatten(screen.getByLabelText('Notes').props.style);
  expect(style.maxHeight).toBe(expected);
  expect(screen.getByLabelText('Notes').props.scrollEnabled).not.toBe(false);
});
