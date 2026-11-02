// ARU-58 (reopened): on an iPhone the notes field still reached under the keyboard, so Save was hidden and there was
// no obvious way to close the keyboard. Now Save is also in the header, the toolbar has Done while the keyboard is
// open, and the field only takes the room left above the keyboard.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Dimensions, Keyboard, StyleSheet } from 'react-native';

import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import type { Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

// Keep the header options the screen sets, so the header Save can be rendered and pressed.
let mockOptions: { headerRight?: () => ReactElement } = {};
jest.mock('expo-router', () => ({
  ...require('./helpers/mocks').expoRouter,
  Stack: {
    Screen: ({ options }: { options: typeof mockOptions }) => {
      mockOptions = options ?? {};
      return null;
    },
  },
}));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
let mockKeyboard = 0;
jest.mock('@/lib/useKeyboardHeight', () => ({ useKeyboardHeight: () => mockKeyboard }));

const HOUR = 60 * 60 * 1000;
const C: Meeting = {
  id: 'C',
  courseId: 'A',
  startsAt: new Date(Date.now() - 30 * HOUR).toISOString(),
  topic: 'Done',
  status: 'completed',
  createdById: 'M',
  createdAt: new Date(Date.now() - 100 * HOUR).toISOString(),
};
const members = [member('A', 'S1')];
const field = () => StyleSheet.flatten(screen.getByLabelText('Notes').props.style);

beforeEach(() => {
  jest.clearAllMocks();
  mockOptions = {};
  mockKeyboard = 0;
  Object.assign(params, { id: 'A', meetingId: 'C', edit: '1' });
});

describe('Save in the header', () => {
  it.each(['M', 'T'] as const)('%s: the header Save saves the notes typed so far', async (who) => {
    const store = fakeStore(who, { courseMembers: members, meetings: [C] });
    setStore(store);
    await render(<MeetingNotesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Four\nlines\nof\nnotes');
    expect(mockOptions.headerRight).toBeDefined();
    const header = await render(mockOptions.headerRight!());
    await fireEvent.press(header.getByRole('button', { name: 'Save notes' }));
    expect(store.setMeetingNotes).toHaveBeenCalledWith('C', 'Four\nlines\nof\nnotes');
  });
});

describe('with the keyboard open (an iPhone keyboard of 336 pt)', () => {
  it('the toolbar has Done, which closes the keyboard', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings: [C] }));
    mockKeyboard = 336;
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await render(<MeetingNotesScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Hide keyboard' }));
    expect(dismiss).toHaveBeenCalled();
  });

  it('no Done while the keyboard is closed', async () => {
    setStore(fakeStore('T', { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    expect(screen.queryByRole('button', { name: 'Hide keyboard' })).toBeNull();
  });

  it.each([
    ['iPhone SE', 667, 260],
    ['iPhone 15', 844, 336],
    ['iPhone 15 Pro Max', 932, 346],
  ])('%s: the field leaves 300 pt above the keyboard for the rest of the form', async (_, height, keyboard) => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height, scale: 3, fontScale: 1 });
    setStore(fakeStore('T', { courseMembers: members, meetings: [C] }));
    mockKeyboard = keyboard;
    await render(<MeetingNotesScreen />);
    const { maxHeight, minHeight } = field();
    expect(maxHeight).toBeLessThanOrEqual(Math.max(96, height - keyboard - 300));
    expect(minHeight).toBeLessThanOrEqual(maxHeight as number);
    // Much smaller than the 40% cap that still ran under the keyboard.
    expect(maxHeight).toBeLessThan(Math.round(height * 0.4));
  });

  it('opening the Link row shrinks the field further', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 932, scale: 3, fontScale: 1 });
    setStore(fakeStore('T', { courseMembers: members, meetings: [C] }));
    mockKeyboard = 346;
    await render(<MeetingNotesScreen />);
    const before = field().maxHeight as number;
    await fireEvent.press(screen.getByRole('button', { name: 'Link' }));
    expect(field().maxHeight as number).toBeLessThan(before);
  });

  it('closing the keyboard gives the field its full height back', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    setStore(fakeStore('T', { courseMembers: members, meetings: [C] }));
    mockKeyboard = 336;
    const { rerender } = await render(<MeetingNotesScreen />);
    const open = field().maxHeight as number;
    mockKeyboard = 0;
    await act(async () => rerender(<MeetingNotesScreen />));
    expect(field().maxHeight as number).toBeGreaterThan(open);
  });
});

afterEach(() => jest.restoreAllMocks());
