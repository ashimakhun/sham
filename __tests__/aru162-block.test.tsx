// ARU-162: block a person (UI side). Access rules, counts and Telegram are tested in
// supabase/tests/aru162_user_blocks.test.sql. M owns A; S1 and S2 are listeners of A.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import BlockedPeopleScreen from '@/app/blocked';
import CourseChatScreen from '@/app/courses/[id]/chat';
import GeneralChatScreen from '@/app/general-chat';
import { ReportMenu } from '@/components/ContentMenu';
import { FeedbackSection } from '@/components/FeedbackSection';
import { I18nContext, make } from '@/i18n/context';
import { ratingSummaryLabel } from '@/lib/feedback';
import en from '@/i18n/en.json';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';
import { canBlock } from '@/lib/roles';
import type { ChatMessage, CourseFeedback, CourseMessage } from '@/lib/types';
import { router } from 'expo-router';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const inRussian = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const members = [member('A', 'S1'), member('A', 'S2')];
const msg = (id: string, authorId: string | null, body: string, minute: number): CourseMessage => ({
  id,
  courseId: 'A',
  authorId,
  body,
  createdAt: new Date(2026, 10, 18, 10, minute).toISOString(),
});
const page = [msg('m3', null, 'From a deleted account', 3), msg('m2', 'S2', 'Sue here', 2), msg('m1', 'S1', 'Sam here', 1)];
// The Alert's second button is the confirm one (confirmAction).
let alertSpy: jest.SpyInstance | undefined;
const spyAlerts = (button: number) => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[button]?.onPress?.());
  return alertSpy;
};
const confirmAlerts = () => spyAlerts(1);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});
afterEach(() => {
  alertSpy?.mockRestore();
  alertSpy = undefined;
});

describe('AC 1 / 2: Block in the chat message menu', () => {
  async function openChat(who: 'S1' | 'S2' | 'M' | 'T', over = {}) {
    const store = fakeStore(who, {
      courseMembers: members,
      loadMessages: jest.fn(async () => ({ messages: page, hasMore: false })),
      ...over,
    });
    setStore(store);
    await render(<CourseChatScreen />);
    await screen.findByText('Sam here');
    return store;
  }

  it('S1 sees "Block Student Sue" after Report on Sue\'s message; confirming blocks Sue', async () => {
    const alert = confirmAlerts();
    const store = await openChat('S1');
    await fireEvent(screen.getByTestId('chat-message-m2'), 'longPress');
    const menu = screen.getByTestId('action-menu');
    const labels = within(menu)
      .getAllByRole('button')
      .map((b) => b.props.accessibilityLabel);
    expect(labels).toEqual(['Report', 'Block Student Sue', 'Cancel']);
    await fireEvent.press(within(menu).getByRole('button', { name: 'Block Student Sue' }));
    await act(async () => {});
    expect(alert).toHaveBeenCalledWith(
      'Block Student Sue?',
      "Student Sue won't be told. You won't see their messages, notes, Blog posts or reviews. You can unblock them in Profile.",
      expect.anything(),
      expect.anything(),
    );
    expect(store.blockUser).toHaveBeenCalledWith('S2');
  });

  it('Cancel in the confirmation changes nothing', async () => {
    spyAlerts(0);
    const store = await openChat('S1');
    await fireEvent(screen.getByTestId('chat-message-m2'), 'longPress');
    await fireEvent.press(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Block Student Sue' }));
    await act(async () => {});
    expect(store.blockUser).not.toHaveBeenCalled();
  });

  it('no Block on my own message or a deleted account\'s (the teacher keeps Delete there)', async () => {
    await openChat('S1');
    expect(screen.getByTestId('chat-message-m1').props.accessibilityActions).toBeUndefined();
    expect(screen.getByTestId('chat-message-m3').props.accessibilityActions).toBeUndefined();
  });

  it('AC 7: Block is a screen reader action too, for every role', async () => {
    for (const who of ['S1', 'M', 'T'] as const) {
      await openChat(who);
      const names = screen.getByTestId('chat-message-m2').props.accessibilityActions.map((a: { name: string }) => a.name);
      expect(names).toContain('block');
    }
  });

  it('a failed block (offline) shows an alert and nothing is hidden', async () => {
    const alert = confirmAlerts();
    await openChat('S1', { blockUser: jest.fn(async () => Promise.reject(new Error('Network request failed'))) });
    await fireEvent(screen.getByTestId('chat-message-m2'), 'longPress');
    await fireEvent.press(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Block Student Sue' }));
    await act(async () => {});
    expect(alert).toHaveBeenLastCalledWith("Couldn't block", expect.any(String));
    expect(screen.getByText('Sue here')).toBeTruthy();
  });
});

describe('AC 2: a blocked person\'s messages are hidden', () => {
  it('in a course chat, including a message arriving live; others and a deleted account\'s still show', async () => {
    let live: ((m: CourseMessage) => void) | undefined;
    setStore(
      fakeStore('S1', {
        courseMembers: members,
        blockedUserIds: ['S2'],
        loadMessages: jest.fn(async () => ({ messages: page, hasMore: false })),
        subscribeToMessages: jest.fn((_id: string, onMessage: (m: CourseMessage) => void) => {
          live = onMessage;
          return () => {};
        }),
      }),
    );
    await render(<CourseChatScreen />);
    await screen.findByText('Sam here');
    expect(screen.queryByText('Sue here')).toBeNull();
    expect(screen.getByText('From a deleted account')).toBeTruthy();
    await act(async () => live?.(msg('m4', 'S2', 'Sue again', 4)));
    expect(screen.queryByText('Sue again')).toBeNull();
    await act(async () => live?.(msg('m5', 'M', 'Max writes', 5)));
    expect(screen.getByText('Max writes')).toBeTruthy();
  });

  it('in the general chat', async () => {
    const general: ChatMessage[] = [
      { id: 'g2', authorId: 'S2', body: 'Sue in general', createdAt: '2026-11-18T10:02:00.000Z' },
      { id: 'g1', authorId: 'T', body: 'Teacher in general', createdAt: '2026-11-18T10:01:00.000Z' },
    ];
    setStore(fakeStore('S1', { blockedUserIds: ['S2'], loadGeneralMessages: jest.fn(async () => ({ messages: general, hasMore: false })) }));
    await render(<GeneralChatScreen />);
    await screen.findByText('Teacher in general');
    expect(screen.queryByText('Sue in general')).toBeNull();
  });

  it('when every loaded message is hidden, the next older page is loaded', async () => {
    const loadMessages = jest
      .fn()
      .mockResolvedValueOnce({ messages: [msg('m2', 'S2', 'Sue here', 2)], hasMore: true })
      .mockResolvedValueOnce({ messages: [msg('m1', 'M', 'Max older', 1)], hasMore: false });
    setStore(fakeStore('S1', { courseMembers: members, blockedUserIds: ['S2'], loadMessages }));
    await render(<CourseChatScreen />);
    await screen.findByText('Max older');
    expect(loadMessages).toHaveBeenCalledTimes(2);
  });
});

describe('AC 1 / 2: the ⋯ menu and reviews', () => {
  const fb = (id: string, userId: string, rating: number): CourseFeedback => ({
    id,
    courseId: 'A',
    userId,
    rating,
    body: `Review ${id}`,
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  });
  const reviews = [fb('f1', 'S1', 5), fb('f2', 'S2', 1)];

  it('a blocked person\'s review card is hidden; the average and count don\'t change', async () => {
    // The summary of both reviews, as without a block.
    const summary = ratingSummaryLabel(reviews, 'en');
    setStore(fakeStore('M', { courseFeedback: reviews, courseMembers: members, blockedUserIds: ['S2'] }));
    await render(<FeedbackSection course={courseA} />);
    expect(screen.queryByTestId('feedback-f2')).toBeNull();
    expect(screen.getByTestId('feedback-f1')).toBeTruthy();
    expect(screen.getByTestId('rating-summary-star').parent?.props.accessibilityLabel).toBe(summary);
  });

  it('Block is in the ⋯ menu of someone else\'s content, not on my own or a deleted account\'s', async () => {
    const store = fakeStore('S1');
    setStore(store);
    confirmAlerts();
    const onBlocked = jest.fn();
    await render(<ReportMenu kind="blog_post" id="b1" authorId="M" onBlocked={onBlocked} />);
    await fireEvent.press(screen.getByTestId('content-menu-b1'));
    await fireEvent.press(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Block Mentor Max' }));
    await act(async () => {});
    expect(store.blockUser).toHaveBeenCalledWith('M');
    expect(onBlocked).toHaveBeenCalled();
    await render(<ReportMenu kind="meeting_note" id="n1" authorId="S1" />);
    expect(screen.queryByTestId('content-menu-n1')).toBeNull();
    expect(canBlock(users.S1, null)).toBe(false);
    expect(canBlock({ ...users.S1, accessStatus: 'pending' }, 'S2')).toBe(false);
    expect(canBlock(users.T, 'S2')).toBe(true);
  });
});

describe('AC 5: Blocked people', () => {
  it('Profile has a Blocked people row for every role', async () => {
    for (const who of ['S1', 'M', 'T'] as const) {
      setStore(fakeStore(who));
      await render(<ProfileScreen />);
      await fireEvent.press(screen.getByRole('button', { name: 'Blocked people' }));
      expect(router.push).toHaveBeenLastCalledWith('/blocked');
    }
  });

  it('empty state', async () => {
    setStore(fakeStore('S1'));
    await render(<BlockedPeopleScreen />);
    expect(screen.getByText("You haven't blocked anyone.")).toBeTruthy();
  });

  it('lists blocked people by name with Unblock; a gone account isn\'t listed', async () => {
    const store = fakeStore('S1', { blockedUserIds: ['S2', 'M', 'gone'] });
    setStore(store);
    await render(<BlockedPeopleScreen />);
    expect(screen.getByTestId('blocked-M')).toBeTruthy();
    expect(screen.getByTestId('blocked-S2')).toBeTruthy();
    expect(screen.queryByTestId('blocked-gone')).toBeNull();
    await fireEvent.press(within(screen.getByTestId('blocked-S2')).getByRole('button', { name: 'Unblock' }));
    expect(store.unblockUser).toHaveBeenCalledWith('S2');
  });
});

describe('AC 7: texts', () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('block.'));

  it('every new text is in English, Russian and the notes, with the same placeholders', () => {
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const k of keys) {
      const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect((ru as Record<string, string>)[k]).toBeTruthy();
      expect((notes as Record<string, string>)[k]).toBeTruthy();
      expect(placeholders((ru as Record<string, string>)[k])).toEqual(placeholders((en as Record<string, string>)[k]));
    }
  });

  it('the menu and the Blocked people screen in Russian', async () => {
    setStore(fakeStore('S1', { courseMembers: members, loadMessages: jest.fn(async () => ({ messages: page, hasMore: false })) }));
    await render(inRussian(<CourseChatScreen />));
    await screen.findByText('Sam here');
    await fireEvent(screen.getByTestId('chat-message-m2'), 'longPress');
    expect(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Заблокировать: Student Sue' })).toBeTruthy();
    setStore(fakeStore('S1'));
    await render(inRussian(<BlockedPeopleScreen />));
    expect(screen.getByText('Вы никого не заблокировали.')).toBeTruthy();
  });
});
