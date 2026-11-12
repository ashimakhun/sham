// QA ARU-153: gaps in aru153-first-note-save-closes.test.tsx. The store gains my note in a separate tick before the
// save resolves (as realtime / the store's own refetch do), a double tap saves once and leaves once, a retry after a
// failed first save closes the editor, and after a failed save a note arriving from another device still remounts the
// editor (the pin is released).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import type { useStore } from '@/lib/store';
import type { Meeting, MeetingListenerNote } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

type Store = ReturnType<typeof useStore>;
const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const at = (h: number) => new Date(NOW + h * HOUR).toISOString();
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
const note = (body: string, isPublic: boolean, id = 'n-S1'): MeetingListenerNote => ({
  id,
  meetingId: 'C',
  courseId: 'A',
  authorId: 'S1',
  body,
  createdAt: at(-1),
  updatedAt: at(-1),
  isPublic,
});
const field = () => screen.getByLabelText('Notes');
const save = () => screen.getByRole('button', { name: 'Save' });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params) as (keyof typeof params)[]) delete params[k];
  Object.assign(params, { id: 'A', meetingId: 'C', edit: '1' });
  (router.canGoBack as jest.Mock).mockReset().mockImplementation(() => true);
});

async function mountWith(store: Store) {
  setStore(store);
  const r = await render(<MeetingNotesScreen />);
  return () => r.rerender(<MeetingNotesScreen />);
}

it('the store gains my note a tick before the save resolves: the editor still closes, once', async () => {
  const store: Store = fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [] });
  let rerender = () => {};
  store.saveMyMeetingNotes = jest.fn(async (_m: string, body: string, isPublic: boolean) => {
    await tick();
    setStore({ ...store, meetingListenerNotes: [note(body, isPublic)] });
    rerender();
    await tick();
  });
  rerender = await mountWith(store);
  await fireEvent.changeText(field(), 'Covered fractions');
  await fireEvent(screen.getByTestId('notes-publish'), 'valueChange', true);
  await act(async () => {
    fireEvent.press(save());
    await tick();
    await tick();
    await tick();
  });
  expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', 'Covered fractions', true);
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(router.replace).not.toHaveBeenCalled();
});

it('a double tap on Save saves once and leaves once', async () => {
  const store: Store = fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [] });
  let rerender = () => {};
  store.saveMyMeetingNotes = jest.fn(async (_m: string, body: string, isPublic: boolean) => {
    await tick();
    setStore({ ...store, meetingListenerNotes: [note(body, isPublic)] });
    rerender();
  });
  rerender = await mountWith(store);
  await fireEvent.changeText(field(), 'Covered fractions');
  await act(async () => {
    fireEvent.press(save());
    fireEvent.press(save());
    await tick();
    await tick();
  });
  expect(store.saveMyMeetingNotes).toHaveBeenCalledTimes(1);
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('a retry after a failed first save closes the editor', async () => {
  const store: Store = fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [] });
  let rerender = () => {};
  let calls = 0;
  store.saveMyMeetingNotes = jest.fn(async (_m: string, body: string, isPublic: boolean) => {
    calls += 1;
    if (calls === 1) throw new Error('Network down');
    setStore({ ...store, meetingListenerNotes: [note(body, isPublic)] });
    rerender();
  });
  rerender = await mountWith(store);
  await fireEvent.changeText(field(), 'Covered fractions');
  await act(async () => fireEvent.press(save()));
  expect(router.back).not.toHaveBeenCalled();
  expect(field().props.value).toBe('Covered fractions');
  await act(async () => fireEvent.press(save()));
  expect(store.saveMyMeetingNotes).toHaveBeenCalledTimes(2);
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('after a failed save, a note saved on another device still gives a fresh editor with that note', async () => {
  const store: Store = fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: [] });
  store.saveMyMeetingNotes = jest.fn(async () => {
    throw new Error('Network down');
  });
  const rerender = await mountWith(store);
  await fireEvent.changeText(field(), 'Draft here');
  await act(async () => fireEvent.press(save()));
  expect(router.back).not.toHaveBeenCalled();
  setStore({ ...store, meetingListenerNotes: [note('From my phone', true)] });
  await act(async () => rerender());
  expect(field().props.value).toBe('From my phone');
  expect(screen.getByTestId('notes-publish').props.value).toBe(true);
});
