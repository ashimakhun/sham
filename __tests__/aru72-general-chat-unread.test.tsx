// ARU-72: new message count on the Profile tab's General chat button (UI side). Counting and access rules are tested
// in supabase/tests/aru72_general_chat_reads.test.sql; the store side in aru72-store-general-unread.test.tsx.
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import GeneralChatScreen from '@/app/general-chat';
import type { GeneralMessage } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

// The badge is hidden from screen readers (its count is in the button's label), so queries must include it.
const hidden = { includeHiddenElements: true };
const msg = (id: string, authorId: string, minute: number): GeneralMessage => ({
  id,
  authorId,
  body: `Message ${id}`,
  createdAt: `2026-11-03T10:${String(minute).padStart(2, '0')}:00.000Z`,
});

beforeEach(() => jest.clearAllMocks());

describe('badge on the General chat button (AC1–AC3, AC10)', () => {
  it.each(['S1', 'M', 'T'] as const)('%s with 3 new messages: badge "3" and the count in the label', async (who) => {
    setStore(fakeStore(who, { generalUnreadCount: 3 }));
    await render(<ProfileScreen />);
    expect(screen.getByRole('button', { name: 'Open general chat, 3 new messages' })).toBeTruthy();
    expect(screen.getByTestId('unread-badge', hidden)).toBeTruthy();
    expect(screen.getByText('3', hidden)).toBeTruthy();
  });

  it('1 new message: singular label', async () => {
    setStore(fakeStore('S1', { generalUnreadCount: 1 }));
    await render(<ProfileScreen />);
    expect(screen.getByRole('button', { name: /^Open general chat, 1 new message/ })).toBeTruthy();
  });

  it('0 new messages: no badge and the plain label', async () => {
    setStore(fakeStore('S1', { generalUnreadCount: 0 }));
    await render(<ProfileScreen />);
    expect(screen.getByRole('button', { name: 'Open general chat' })).toBeTruthy();
    expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
  });

  it('99 reads "99", more than 99 reads "99+"', async () => {
    setStore(fakeStore('S1', { generalUnreadCount: 99 }));
    const view = await render(<ProfileScreen />);
    expect(screen.getByText('99', hidden)).toBeTruthy();
    await view.unmount();
    setStore(fakeStore('S1', { generalUnreadCount: 150 }));
    await render(<ProfileScreen />);
    expect(screen.getByText('99+', hidden)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open general chat, 99+ new messages' })).toBeTruthy();
  });

  it('only the General chat button carries the count', async () => {
    setStore(fakeStore('T', { generalUnreadCount: 4 }));
    await render(<ProfileScreen />);
    const labelled = screen.getAllByRole('button').filter((b) => /new messages/.test(b.props.accessibilityLabel ?? ''));
    expect(labelled).toHaveLength(1);
    expect(screen.getAllByTestId('unread-badge', hidden)).toHaveLength(1);
  });
});

describe('the General chat screen marks messages read (AC4, AC5)', () => {
  it('opening marks read up to the newest message shown and marks the chat open', async () => {
    const page = [msg('g3', 'M', 3), msg('g2', 'T', 2), msg('g1', 'M', 1)];
    const store = fakeStore('S1', { loadGeneralMessages: jest.fn(async () => ({ messages: page, hasMore: false })) });
    setStore(store);
    await render(<GeneralChatScreen />);
    await waitFor(() => expect(store.markGeneralChatRead).toHaveBeenCalledWith('g3'));
    expect(store.setGeneralChatOpen).toHaveBeenCalledWith(true);
    expect(store.markChatRead).not.toHaveBeenCalled(); // AC11: course positions untouched
  });

  it('a message arriving while open is marked read at once', async () => {
    let push: (m: GeneralMessage) => void = () => {};
    const store = fakeStore('S1', {
      loadGeneralMessages: jest.fn(async () => ({ messages: [msg('g1', 'M', 1)], hasMore: false })),
      subscribeToGeneralMessages: jest.fn((cb: (m: GeneralMessage) => void) => {
        push = cb;
        return () => {};
      }),
    });
    setStore(store);
    await render(<GeneralChatScreen />);
    await waitFor(() => expect(store.markGeneralChatRead).toHaveBeenCalledWith('g1'));
    await act(async () => push(msg('g2', 'T', 2)));
    await waitFor(() => expect(store.markGeneralChatRead).toHaveBeenCalledWith('g2'));
  });

  it('leaving saves the position again and marks the chat closed', async () => {
    const store = fakeStore('S1', {
      loadGeneralMessages: jest.fn(async () => ({ messages: [msg('g1', 'M', 1)], hasMore: false })),
    });
    setStore(store);
    const view = await render(<GeneralChatScreen />);
    await waitFor(() => expect(store.markGeneralChatRead).toHaveBeenCalledWith('g1'));
    jest.mocked(store.markGeneralChatRead).mockClear();
    await view.unmount();
    expect(store.setGeneralChatOpen).toHaveBeenLastCalledWith(false);
    expect(store.markGeneralChatRead).toHaveBeenCalledWith('g1');
  });

  it('an empty chat marks nothing', async () => {
    const store = fakeStore('S1');
    setStore(store);
    await render(<GeneralChatScreen />);
    expect(await screen.findByText('No messages yet. Say hello to everyone!')).toBeTruthy();
    expect(store.markGeneralChatRead).not.toHaveBeenCalled();
  });

  it('going to the background saves the position', async () => {
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      listeners.push(cb as (s: string) => void);
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    const store = fakeStore('S1', {
      loadGeneralMessages: jest.fn(async () => ({ messages: [msg('g1', 'M', 1)], hasMore: false })),
    });
    setStore(store);
    await render(<GeneralChatScreen />);
    await waitFor(() => expect(store.markGeneralChatRead).toHaveBeenCalledWith('g1'));
    jest.mocked(store.markGeneralChatRead).mockClear();
    await act(async () => listeners.forEach((l) => l('background')));
    expect(store.markGeneralChatRead).toHaveBeenCalledWith('g1');
  });
});
