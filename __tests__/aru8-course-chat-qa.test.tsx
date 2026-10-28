// ARU-8 QA additions to aru8-course-chat.test.tsx: screen title, own vs others' alignment and order, losing
// access while the chat is open, Owner tag after an owner change, removed authors, and retry after an error.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState, StyleSheet } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import CourseChatScreen from '@/app/courses/[id]/chat';
import type { CourseMessage } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

const mockScreenOptions: { title?: string }[] = [];
jest.mock('expo-router', () => ({
  ...require('./helpers/mocks').expoRouter,
  Stack: { Screen: ({ options }: { options: { title?: string } }) => (mockScreenOptions.push(options), null) },
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const members = [member('A', 'S1'), member('A', 'M2')];
const msg = (id: string, authorId: string, body: string, minute: number): CourseMessage => ({
  id,
  courseId: 'A',
  authorId,
  body,
  createdAt: `2026-10-28T10:${String(minute).padStart(2, '0')}:00.000Z`,
});
const page = (messages: CourseMessage[], hasMore = false) => jest.fn(async () => ({ messages, hasMore }));
/** The message bubble (the View with alignSelf) that contains this text. */
const bubbleNode = (text: string) => {
  let node = screen.getByText(text).parent;
  while (node && StyleSheet.flatten(node.props.style)?.alignSelf === undefined) node = node.parent;
  if (!node) throw new Error(`no bubble around "${text}"`);
  return node;
};
const bubbleOf = (text: string) => StyleSheet.flatten(bubbleNode(text).props.style);

beforeEach(() => {
  jest.clearAllMocks();
  mockScreenOptions.length = 0;
  params.id = 'A';
});

it('AC1: the chat screen is titled with the course name', async () => {
  setStore(fakeStore('T', { courseMembers: members }));
  await render(<CourseChatScreen />);
  expect(mockScreenOptions.at(-1)).toEqual({ title: 'Algebra' });
});

it('AC3: own messages are aligned right, others left; the list is inverted so the newest is at the bottom', async () => {
  const loadMessages = page([msg('m3', 'S1', 'Mine', 3), msg('m2', 'M2', 'From Mo', 2), msg('m1', 'M', 'Welcome', 1)]);
  setStore(fakeStore('S1', { courseMembers: members, loadMessages }));
  const { container } = await render(<CourseChatScreen />);
  await screen.findByText('Mine');
  expect(bubbleOf('Mine').alignSelf).toBe('flex-end');
  expect(bubbleOf('From Mo').alignSelf).toBe('flex-start');
  expect(bubbleOf('Welcome').alignSelf).toBe('flex-start');
  const list = container.queryAll((n) => n.props.inverted === true && Array.isArray(n.props.data))[0];
  // Inverted list: data is newest first, which renders oldest at the top and newest at the bottom.
  expect(list.props.data.map((m: CourseMessage) => m.id)).toEqual(['m3', 'm2', 'm1']);
  // The owner's role badge and the student's both show.
  expect(screen.getAllByText('Mentor').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Student')).toBeTruthy();
});

it('AC8: removed while the chat is open -> "You are no longer in this course", no input; the Chat button goes', async () => {
  setStore(fakeStore('S1', { courseMembers: members, loadMessages: page([msg('m1', 'M', 'Welcome', 1)]) }));
  const { rerender } = await render(<CourseChatScreen />);
  expect(await screen.findByText('Welcome')).toBeTruthy();
  // The live store update after the owner removes S1 (ARU-7).
  setStore(fakeStore('S1', { courseMembers: [member('A', 'M2')] }));
  await rerender(<CourseChatScreen />);
  expect(screen.getByText('You are no longer in this course')).toBeTruthy();
  expect(screen.queryByLabelText('Message')).toBeNull();
  expect(screen.queryByText('Welcome')).toBeNull();
  await rerender(<CourseDetailScreen />);
  expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
});

it('AC10: after an owner change the Owner tag follows the new owner and the old owner keeps their name', async () => {
  const messages = [msg('m2', 'N', 'New owner', 2), msg('m1', 'M', 'Old owner', 1)];
  setStore(
    fakeStore('S1', {
      courses: [{ ...courseA, createdById: 'N' }],
      courseMembers: members,
      loadMessages: page(messages),
    }),
  );
  await render(<CourseChatScreen />);
  await screen.findByText('Old owner');
  expect(screen.getByText('Mentor Max')).toBeTruthy();
  expect(screen.getAllByText('Owner')).toHaveLength(1);
  // The tag is in N's bubble, not M's.
  expect(within(bubbleNode('New owner')).getByText('Owner')).toBeTruthy();
  expect(within(bubbleNode('Old owner')).queryByText('Owner')).toBeNull();
  expect(screen.getByText('Mentor Nina')).toBeTruthy();
});

it('AC10: the former owner who is not a listener sees "You are no longer in this course"', async () => {
  setStore(fakeStore('M', { courses: [{ ...courseA, createdById: 'N' }], courseMembers: members }));
  await render(<CourseChatScreen />);
  expect(screen.getByText('You are no longer in this course')).toBeTruthy();
});

it('AC11: a former listener\'s old messages still show their name to the others', async () => {
  // S2 is no longer a listener of A but wrote earlier.
  setStore(fakeStore('M', { courseMembers: members, loadMessages: page([msg('m1', 'S2', 'Bye all', 1)]) }));
  await render(<CourseChatScreen />);
  expect(await screen.findByText('Bye all')).toBeTruthy();
  expect(screen.getByText('Student Sue')).toBeTruthy();
  expect(screen.queryByText('Former member')).toBeNull();
});

it('AC6: after a failed send the error shows, the text stays, and a retry succeeds with the same id', async () => {
  const sendMessage = jest
    .fn()
    .mockRejectedValueOnce(new Error('new row violates row-level security policy for table "course_messages"'))
    .mockResolvedValueOnce(undefined);
  setStore(fakeStore('M2', { courseMembers: members, sendMessage }));
  await render(<CourseChatScreen />);
  await fireEvent.changeText(screen.getByLabelText('Message'), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText(/row-level security/)).toBeTruthy();
  expect(screen.getByDisplayValue('Hello')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(screen.queryByDisplayValue('Hello')).toBeNull());
  expect(sendMessage.mock.calls[1][0].id).toBe(sendMessage.mock.calls[0][0].id);
  // The next message gets a fresh id.
  await fireEvent.changeText(screen.getByLabelText('Message'), 'Second');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
  expect(sendMessage.mock.calls[2][0].id).not.toBe(sendMessage.mock.calls[0][0].id);
});

it('edge: returning to the foreground refetches and shows missed messages once', async () => {
  const loadMessages = jest
    .fn()
    .mockResolvedValueOnce({ messages: [msg('m1', 'M', 'Before', 1)], hasMore: false })
    .mockResolvedValue({ messages: [msg('m2', 'M', 'While away', 2), msg('m1', 'M', 'Before', 1)], hasMore: false });
  const listeners: ((s: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    listeners.push(fn as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
  setStore(fakeStore('S1', { courseMembers: members, loadMessages }));
  await render(<CourseChatScreen />);
  await screen.findByText('Before');
  await act(async () => listeners.forEach((fn) => fn('active')));
  expect(await screen.findByText('While away')).toBeTruthy();
  expect(screen.getAllByText('Before')).toHaveLength(1);
});

it('edge: more than 50 messages missed in the background are all reachable afterwards (no gap)', async () => {
  // 60 messages exist when the chat opens; 100 more arrive while the app is in the background.
  const at = (i: number): CourseMessage => ({
    id: `m${String(i).padStart(3, '0')}`,
    courseId: 'A',
    authorId: 'M',
    body: `msg ${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 28, 10, 0, i)).toISOString(),
  });
  const all = Array.from({ length: 160 }, (_, i) => at(i));
  let existing = all.slice(0, 60);
  // Behaves like store.loadMessages against the database: the newest 50 older than the cursor.
  const loadMessages = jest.fn(async (_course: string, before?: CourseMessage) => {
    const older = existing.filter((m) => !before || m.createdAt < before.createdAt).reverse();
    return { messages: older.slice(0, 50), hasMore: older.length > 50 };
  });
  const listeners: ((s: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    listeners.push(fn as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
  setStore(fakeStore('M', { courseMembers: members, loadMessages }));
  const { container } = await render(<CourseChatScreen />);
  await screen.findByText('msg 59');

  existing = all; // in the background, realtime missed messages 60..159
  await act(async () => listeners.forEach((fn) => fn('active')));
  await screen.findByText('msg 159');
  // Scroll to the top until there is nothing more to load.
  const list = () => container.queryAll((n) => n.props.inverted === true && Array.isArray(n.props.data))[0];
  for (let i = 0; i < 6; i++) await act(async () => list().props.onEndReached());

  const shown = new Set(list().props.data.map((m: CourseMessage) => m.id));
  const missing = all.filter((m) => !shown.has(m.id)).map((m) => m.body);
  expect(missing).toEqual([]);
});
