// ARU-8: course chat for the owner, listeners and the teacher (UI side). Access rules are tested in
// supabase/tests/aru8_course_chat.test.sql. M owns A; S1 and M2 are listeners of A; N and S2 are not in A.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import CourseChatScreen from '@/app/courses/[id]/chat';
import type { CourseMessage } from '@/lib/types';
import { mergeMessages } from '@/lib/useCourseChat';
import { router } from 'expo-router';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
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
const button = (name: string | RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('Chat button on course details', () => {
  it.each(['M', 'S1', 'M2', 'T'] as const)('AC1: %s (owner, listener or teacher) sees "Chat" and it opens the chat', async (who) => {
    setStore(fakeStore(who, { courseMembers: members }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(button('Chat'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/chat', params: { id: 'A' } });
  });

  it.each(['N', 'S2'] as const)('AC2: %s (not in the course) sees no "Chat"', async (who) => {
    setStore(fakeStore(who, { courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
  });
});

describe('Chat screen', () => {
  it('AC3: shows author, role, Owner tag on the owner\'s messages, text and time', async () => {
    const page = [msg('m2', 'S1', 'Question?', 2), msg('m1', 'M', 'Welcome', 1)]; // newest first, as loaded
    setStore(fakeStore('S1', { courseMembers: members, loadMessages: jest.fn(async () => ({ messages: page, hasMore: false })) }));
    await render(<CourseChatScreen />);
    expect(await screen.findByText('Welcome')).toBeTruthy();
    expect(screen.getByText('Question?')).toBeTruthy();
    expect(screen.getByText('Mentor Max')).toBeTruthy();
    expect(screen.getAllByText('Owner')).toHaveLength(1);
    expect(screen.getAllByText(/10:0[12]|AM|PM/).length).toBeGreaterThan(0);
  });

  it('AC4/AC6: sending posts with a client id, clears the input, and a failed retry keeps the same id', async () => {
    const sendMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(undefined);
    const store = fakeStore('S1', { courseMembers: members, sendMessage });
    setStore(store);
    await render(<CourseChatScreen />);
    const input = screen.getByLabelText('Message');
    await fireEvent.changeText(input, 'Hello class');
    await fireEvent.press(button('Send'));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(input.props.value).toBe('Hello class'); // text kept for the retry
    await fireEvent.press(button('Send'));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    const [first, second] = sendMessage.mock.calls.map((c) => c[0]);
    expect(second).toEqual(first); // same id: the database rejects a duplicate, so it can't post twice
    expect(first).toEqual(expect.objectContaining({ courseId: 'A', body: 'Hello class' }));
    await waitFor(() => expect(screen.getByLabelText('Message').props.value).toBe(''));
  });

  it('AC5: Send is disabled for blank text and the input stops at 2000 characters', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    await render(<CourseChatScreen />);
    expect(button('Send')).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Message'), '   ');
    expect(button('Send')).toBeDisabled();
    expect(screen.getByLabelText('Message').props.maxLength).toBe(2000);
  });

  it('AC4: a live message from someone else appears without a reload', async () => {
    let push: (m: CourseMessage) => void = () => {};
    const subscribeToMessages = jest.fn((_course: string, cb: (m: CourseMessage) => void) => {
      push = cb;
      return () => {};
    });
    setStore(fakeStore('M2', { courseMembers: members, subscribeToMessages }));
    await render(<CourseChatScreen />);
    expect(subscribeToMessages).toHaveBeenCalledWith('A', expect.any(Function));
    await act(async () => push(msg('live', 'S1', 'Live hello', 5)));
    expect(screen.getByText('Live hello')).toBeTruthy();
  });

  it('AC7: loads the latest page first and older ones when scrolling to the top', async () => {
    const latest = Array.from({ length: 50 }, (_, i) => msg(`n${i}`, 'M', `new ${i}`, 59 - i));
    const loadMessages = jest
      .fn()
      .mockResolvedValueOnce({ messages: latest, hasMore: true })
      .mockResolvedValueOnce({ messages: [msg('old', 'M', 'oldest', 0)], hasMore: false });
    setStore(fakeStore('M', { courseMembers: members, loadMessages }));
    const { container } = await render(<CourseChatScreen />);
    await waitFor(() => expect(loadMessages).toHaveBeenCalledTimes(1));
    const list = container.queryAll((n) => typeof n.props.onEndReached === 'function')[0];
    await act(async () => list.props.onEndReached());
    expect(loadMessages).toHaveBeenLastCalledWith('A', latest[49]); // cursor = oldest loaded message
  });

  it('AC8: someone no longer in the course sees "You are no longer in this course"', async () => {
    setStore(fakeStore('S2', { courseMembers: members }));
    await render(<CourseChatScreen />);
    expect(screen.getByText('You are no longer in this course')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
  });

  it('AC12: an empty chat invites to start the discussion; the owner can post with no listeners', async () => {
    setStore(fakeStore('M', { courseMembers: [] }));
    await render(<CourseChatScreen />);
    expect(await screen.findByText('No messages yet — start the discussion')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });
});

describe('mergeMessages', () => {
  it('edge: dedupes by id and orders newest first with id as tie-breaker', () => {
    const a = msg('a', 'M', 'x', 1);
    const b = msg('b', 'M', 'y', 1); // same timestamp as a
    const c = msg('c', 'M', 'z', 2);
    expect(mergeMessages([a, c], [b, a]).map((m) => m.id)).toEqual(['c', 'b', 'a']);
  });
});
