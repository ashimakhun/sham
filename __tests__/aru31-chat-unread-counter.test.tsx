// ARU-31: new message counter on a course's chat entry points (card icon and Chat button on course details).
// Counting and access rules are tested in supabase/tests/aru31_chat_read_positions.test.sql.
// M owns A; S1 and M2 are listeners of A; N owns B; S2 is in no course.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import CourseChatScreen from '@/app/courses/[id]/chat';
import type { CourseMessage } from '@/lib/types';
import { formatUnread, withUnreadLabel } from '@/lib/unread';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courses = [courseB, courseA];
const members = [member('A', 'S1'), member('A', 'M2')];
const counts = (c: Record<string, number>) => (id: string) => c[id] ?? 0;
// The badge is hidden from screen readers (its count is in the button's label), so queries must include it.
const hidden = { includeHiddenElements: true };
const showAll = () => fireEvent.press(screen.getByRole('tab', { name: 'All courses' }));
const msg = (id: string, authorId: string, minute: number): CourseMessage => ({
  id,
  courseId: 'A',
  authorId,
  body: `Message ${id}`,
  createdAt: `2026-10-28T10:${String(minute).padStart(2, '0')}:00.000Z`,
});

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('formatting', () => {
  it('AC4: 99 reads "99", 100 and 150 read "99+"', () => {
    expect(formatUnread(1)).toBe('1');
    expect(formatUnread(99)).toBe('99');
    expect(formatUnread(100)).toBe('99+');
    expect(formatUnread(150)).toBe('99+');
  });

  it('AC11: the count joins the label; 0 leaves it unchanged', () => {
    expect(withUnreadLabel('Open chat for Algebra', 3)).toBe('Open chat for Algebra, 3 new messages');
    expect(withUnreadLabel('Open chat for Algebra', 1)).toBe('Open chat for Algebra, 1 new message');
    expect(withUnreadLabel('Open chat for Algebra', 120)).toBe('Open chat for Algebra, 99+ new messages');
    expect(withUnreadLabel('Open chat for Algebra', 0)).toBe('Open chat for Algebra');
  });
});

describe('course card (AC1, AC3, AC4, AC11)', () => {
  it.each(['S1', 'M2', 'M', 'T'] as const)('%s sees the count on A in My courses and All courses', async (who) => {
    setStore(fakeStore(who, { courses, courseMembers: members, unreadCount: counts({ A: 3 }) }));
    await render(<CoursesScreen />);
    if (who !== 'T') {
      expect(screen.getByRole('button', { name: 'Open chat for Algebra, 3 new messages' })).toBeTruthy();
      expect(screen.getByText('3', hidden)).toBeTruthy();
    }
    await showAll();
    expect(screen.getByRole('button', { name: 'Open chat for Algebra, 3 new messages' })).toBeTruthy();
    expect(screen.getByText('3', hidden)).toBeTruthy();
  });

  it('0 new messages: no badge and the ARU-25 label', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members, unreadCount: counts({}) }));
    await render(<CoursesScreen />);
    expect(screen.getByRole('button', { name: 'Open chat for Algebra' })).toBeTruthy();
    expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
  });

  it('more than 99 shows "99+"', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members, unreadCount: counts({ A: 150 }) }));
    await render(<CoursesScreen />);
    expect(screen.getByText('99+', hidden)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open chat for Algebra, 99+ new messages' })).toBeTruthy();
  });

  it.each(['S2', 'N'] as const)('%s (not in A) sees no icon and no count, whatever the store says', async (who) => {
    setStore(fakeStore(who, { courses, courseMembers: members, unreadCount: counts({ A: 5 }) }));
    await render(<CoursesScreen />);
    await showAll();
    expect(screen.queryByRole('button', { name: /Open chat for Algebra/ })).toBeNull();
    expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
  });

  it('the count is not in the content button\'s label (ARU-34)', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members, unreadCount: counts({ A: 3 }) }));
    await render(<CoursesScreen />);
    const buttons = screen.getAllByRole('button');
    const labelled = buttons.filter((b) => /new messages/.test(b.props.accessibilityLabel ?? ''));
    expect(labelled).toHaveLength(1);
  });
});

describe('Chat button on course details (AC2, AC3, AC11)', () => {
  it('shows the same count, with the count in its label', async () => {
    setStore(fakeStore('S1', { courseMembers: members, unreadCount: counts({ A: 3 }) }));
    await render(<CourseDetailScreen />);
    expect(screen.getByRole('button', { name: 'Chat, 3 new messages' })).toBeTruthy();
    expect(screen.getByText('3', hidden)).toBeTruthy();
  });

  it('0 new messages: plain "Chat" with no badge', async () => {
    setStore(fakeStore('S1', { courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.getByRole('button', { name: 'Chat' })).toBeTruthy();
    expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
  });
});

describe('chat screen marks messages read (AC5, AC6)', () => {
  it('opening the chat marks it read up to the newest message shown and makes it the active chat', async () => {
    const page = [msg('m3', 'M', 3), msg('m2', 'M2', 2), msg('m1', 'M', 1)];
    const store = fakeStore('S1', {
      courseMembers: members,
      loadMessages: jest.fn(async () => ({ messages: page, hasMore: false })),
    });
    setStore(store);
    await render(<CourseChatScreen />);
    await waitFor(() => expect(store.markChatRead).toHaveBeenCalledWith('A', 'm3'));
    expect(store.setActiveChat).toHaveBeenCalledWith('A');
  });

  it('a message arriving while open is marked read at once', async () => {
    let onMessage: (m: CourseMessage) => void = () => {};
    const store = fakeStore('S1', {
      courseMembers: members,
      loadMessages: jest.fn(async () => ({ messages: [msg('m1', 'M', 1)], hasMore: false })),
      subscribeToMessages: jest.fn((_id: string, cb: (m: CourseMessage) => void) => {
        onMessage = cb;
        return () => {};
      }),
    });
    setStore(store);
    await render(<CourseChatScreen />);
    await waitFor(() => expect(store.markChatRead).toHaveBeenCalledWith('A', 'm1'));
    await act(async () => onMessage(msg('m2', 'M2', 2)));
    await waitFor(() => expect(store.markChatRead).toHaveBeenCalledWith('A', 'm2'));
  });

  it('leaving the chat saves the read position again and clears the active chat', async () => {
    const store = fakeStore('S1', {
      courseMembers: members,
      loadMessages: jest.fn(async () => ({ messages: [msg('m1', 'M', 1)], hasMore: false })),
    });
    setStore(store);
    const view = await render(<CourseChatScreen />);
    await waitFor(() => expect(store.markChatRead).toHaveBeenCalledWith('A', 'm1'));
    jest.mocked(store.markChatRead).mockClear();
    await view.unmount();
    expect(store.setActiveChat).toHaveBeenLastCalledWith(null);
    expect(store.markChatRead).toHaveBeenCalledWith('A', 'm1');
  });

  it('going to the background saves the read position', async () => {
    const listeners: ((s: string) => void)[] = [];
    // Kept for the rest of the file (restoring it mid-file breaks the cleanup of screens still mounted).
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      listeners.push(cb as (s: string) => void);
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    const store = fakeStore('S1', {
      courseMembers: members,
      loadMessages: jest.fn(async () => ({ messages: [msg('m1', 'M', 1)], hasMore: false })),
    });
    setStore(store);
    await render(<CourseChatScreen />);
    await waitFor(() => expect(store.markChatRead).toHaveBeenCalledWith('A', 'm1'));
    jest.mocked(store.markChatRead).mockClear();
    await act(async () => listeners.forEach((l) => l('background')));
    expect(store.markChatRead).toHaveBeenCalledWith('A', 'm1');
  });

  it('an empty chat marks nothing', async () => {
    const store = fakeStore('S1', { courseMembers: members });
    setStore(store);
    await render(<CourseChatScreen />);
    expect(await screen.findByText('No messages yet — start the discussion')).toBeTruthy();
    expect(store.markChatRead).not.toHaveBeenCalled();
  });
});
