// ARU-153: the first save of a new note closes the editor, even though the store gains my note (and its id) while the
// save is in flight. Before the fix the editor was keyed by my note's id, so my own save remounted it and lost the
// navigation it had scheduled.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router, usePreventRemove } from 'expo-router';

import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import type { useStore } from '@/lib/store';
import type { Meeting, MeetingListenerNote } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

type Store = ReturnType<typeof useStore>;
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
const mine = (body: string, isPublic: boolean, id = 'n-S1'): MeetingListenerNote => ({
  id,
  meetingId: 'C',
  courseId: 'A',
  authorId: 'S1',
  body,
  createdAt: at(-1),
  updatedAt: at(-1),
  isPublic,
});
const save = () => screen.getByRole('button', { name: 'Save' });
/** The last value passed to usePreventRemove's first argument (is the unsaved-changes prompt armed?). */
const promptArmed = () => {
  const calls = (usePreventRemove as jest.Mock).mock.calls;
  return calls[calls.length - 1][0] as boolean;
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params) as (keyof typeof params)[]) delete params[k];
  Object.assign(params, { id: 'A', meetingId: 'C', edit: '1' });
  // A test's mockReturnValueOnce must not leak into the next one.
  (router.canGoBack as jest.Mock).mockReset().mockImplementation(() => true);
});

/** A store whose save, like the real one, adds my note to the store (re-rendering the screen) before it resolves. */
function realisticStore(existing: MeetingListenerNote[] = []) {
  let rerender: (() => void) | null = null;
  const store: Store = fakeStore('S1', { courseMembers: members, meetings: [C], meetingListenerNotes: existing });
  store.saveMyMeetingNotes = jest.fn(async (_meetingId: string, body: string, isPublic: boolean) => {
    const prev = existing.find((n) => n.authorId === 'S1');
    setStore({ ...store, meetingListenerNotes: [{ ...(prev ?? mine(body, isPublic)), body, isPublic }] });
    rerender?.();
  });
  setStore(store);
  return {
    store,
    mount: async () => {
      const r = await render(<MeetingNotesScreen />);
      rerender = () => r.rerender(<MeetingNotesScreen />);
    },
  };
}

describe('AC 1: the first save of a new note closes the editor', () => {
  it.each([
    ['private', false],
    ['public', true],
  ])('a %s note: goes back to the course details', async (_name, isPublic) => {
    const { store, mount } = realisticStore();
    await mount();
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Covered fractions');
    if (isPublic) await fireEvent(screen.getByTestId('notes-publish'), 'valueChange', true);
    await act(async () => fireEvent.press(save()));
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith('C', 'Covered fractions', isPublic);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('with no screen to go back to, replaces with the course details', async () => {
    (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
    const { mount } = realisticStore();
    await mount();
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Covered fractions');
    await act(async () => fireEvent.press(save()));
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });
});

describe('AC 2: editing an existing note still closes the editor', () => {
  it('goes back after Save', async () => {
    const { mount } = realisticStore([mine('Old text', false)]);
    await mount();
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'New text');
    await act(async () => fireEvent.press(save()));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});

describe('AC 3: the unsaved-changes prompt', () => {
  it('is armed with real unsaved changes, and off after a successful first save', async () => {
    const { mount } = realisticStore();
    await mount();
    expect(promptArmed()).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Covered fractions');
    expect(promptArmed()).toBe(true);
    await act(async () => fireEvent.press(save()));
    expect(promptArmed()).toBe(false);
  });

  it('a failed first save keeps the editor open with the text, and the prompt armed', async () => {
    const { store, mount } = realisticStore();
    store.saveMyMeetingNotes = jest.fn(async () => {
      throw new Error('Network down');
    });
    await mount();
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Covered fractions');
    await act(async () => fireEvent.press(save()));
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Notes').props.value).toBe('Covered fractions');
    expect(promptArmed()).toBe(true);
  });
});

describe('AC 4: a note saved on another device while the editor is open', () => {
  it('still gives a fresh editor for that note, so Save updates it', async () => {
    const store = fakeStore('S1', { courseMembers: members, meetings: [C] });
    setStore(store);
    const r = await render(<MeetingNotesScreen />);
    expect(screen.getByLabelText('Notes').props.value).toBe('');
    setStore({ ...store, meetingListenerNotes: [mine('From my phone', true)] });
    await act(async () => r.rerender(<MeetingNotesScreen />));
    expect(screen.getByLabelText('Notes').props.value).toBe('From my phone');
    expect(screen.getByTestId('notes-publish').props.value).toBe(true);
  });
});
