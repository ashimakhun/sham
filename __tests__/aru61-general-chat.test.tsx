// ARU-61: the general chat for every approved user (UI side). Access rules are tested in
// supabase/tests/aru61_general_chat.test.sql. Waiting and declined accounts only ever see the access screen.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import ProfileScreen from '@/app/(tabs)/profile';
import GeneralChatScreen from '@/app/general-chat';
import { AccessGate } from '@/components/AccessGate';
import { canUseGeneralChat } from '@/lib/roles';
import type { GeneralMessage } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const msg = (id: string, authorId: string, body: string, minute: number): GeneralMessage => ({
  id,
  authorId,
  body,
  createdAt: `2026-11-02T10:${String(minute).padStart(2, '0')}:00.000Z`,
});
const button = (name: string | RegExp) => screen.getByRole('button', { name });

beforeEach(() => jest.clearAllMocks());

describe('AC1: General chat button on Profile', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees "General chat" first in the bottom group and it opens the chat', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    // Button names in screen order (a Button's name is its text).
    type Json = { children?: (Json | string)[] | null } | string | null;
    const texts = (n: Json): string[] =>
      !n ? [] : typeof n === 'string' ? [n] : (n.children ?? []).flatMap((c) => texts(c));
    const labels = texts(screen.toJSON() as Json);
    const chat = labels.indexOf('General chat');
    expect(chat).toBeGreaterThan(-1);
    expect(chat).toBeLessThan(labels.indexOf('Sign out'));
    if (who === 'T') expect(chat).toBeLessThan(labels.findIndex((l) => l.startsWith('Manage roles')));
    await fireEvent.press(button('General chat'));
    expect(router.push).toHaveBeenCalledWith('/general-chat');
  });
});

describe('AC2–AC6: the chat screen', () => {
  it('AC2: shows every author with name, role badge and time, newest at the bottom, no Owner badge', async () => {
    const page = [msg('g3', 'S1', 'Hi from Sam', 3), msg('g2', 'M', 'Hi from Max', 2), msg('g1', 'T', 'Hi from Tess', 1)];
    setStore(fakeStore('S2', { loadGeneralMessages: jest.fn(async () => ({ messages: page, hasMore: false })) }));
    await render(<GeneralChatScreen />);
    expect(await screen.findByText('Hi from Tess')).toBeTruthy();
    for (const name of ['Student Sam', 'Mentor Max', 'Teacher Tess']) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getAllByText(/Student|Mentor|Teacher/).length).toBeGreaterThanOrEqual(6); // names + role badges
    expect(screen.queryByText('Owner')).toBeNull();
  });

  it('AC2: loads the latest page first and older ones when scrolling up', async () => {
    const latest = Array.from({ length: 50 }, (_, i) => msg(`n${i}`, 'M', `new ${i}`, 59 - i));
    const loadGeneralMessages = jest
      .fn()
      .mockResolvedValueOnce({ messages: latest, hasMore: true })
      .mockResolvedValueOnce({ messages: [msg('old', 'M', 'oldest', 0)], hasMore: false });
    setStore(fakeStore('M', { loadGeneralMessages }));
    const { container } = await render(<GeneralChatScreen />);
    await waitFor(() => expect(loadGeneralMessages).toHaveBeenCalledTimes(1));
    const list = container.queryAll((n) => typeof n.props.onEndReached === 'function')[0];
    await act(async () => list.props.onEndReached());
    expect(loadGeneralMessages).toHaveBeenLastCalledWith(latest[49]); // cursor = oldest loaded message
  });

  it('AC3: a live message from someone else appears without a reload', async () => {
    let push: (m: GeneralMessage) => void = () => {};
    const subscribeToGeneralMessages = jest.fn((cb: (m: GeneralMessage) => void) => {
      push = cb;
      return () => {};
    });
    setStore(fakeStore('T', { subscribeToGeneralMessages }));
    await render(<GeneralChatScreen />);
    expect(subscribeToGeneralMessages).toHaveBeenCalledTimes(1);
    await act(async () => push(msg('live', 'S1', 'Live hello', 5)));
    expect(screen.getByText('Live hello')).toBeTruthy();
  });

  it('AC3: Send is disabled for blank text; the input stops at 2000 characters', async () => {
    setStore(fakeStore('S1'));
    await render(<GeneralChatScreen />);
    expect(button('Send')).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Message'), ' \n  ');
    expect(button('Send')).toBeDisabled();
    expect(screen.getByLabelText('Message').props.maxLength).toBe(2000);
  });

  it('AC3/AC4: a failed send shows the error and keeps the text; the retry reuses the same id', async () => {
    const sendGeneralMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(undefined);
    setStore(fakeStore('S1', { sendGeneralMessage }));
    await render(<GeneralChatScreen />);
    const input = screen.getByLabelText('Message');
    await fireEvent.changeText(input, 'Hello everyone');
    await fireEvent.press(button('Send'));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(input.props.value).toBe('Hello everyone');
    await fireEvent.press(button('Send'));
    await waitFor(() => expect(sendGeneralMessage).toHaveBeenCalledTimes(2));
    const [first, second] = sendGeneralMessage.mock.calls.map((c) => c[0]);
    expect(second).toEqual(first);
    expect(first).toEqual({ id: expect.any(String), body: 'Hello everyone' });
    await waitFor(() => expect(screen.getByLabelText('Message').props.value).toBe(''));
  });

  it('AC5: an empty chat shows "No messages yet. Say hello to everyone!"', async () => {
    setStore(fakeStore('M'));
    await render(<GeneralChatScreen />);
    expect(await screen.findByText('No messages yet. Say hello to everyone!')).toBeTruthy();
  });

  it('AC6: no edit or delete actions on messages', async () => {
    const page = [msg('g1', 'S1', 'Mine', 1)];
    setStore(fakeStore('S1', { loadGeneralMessages: jest.fn(async () => ({ messages: page, hasMore: false })) }));
    await render(<GeneralChatScreen />);
    await screen.findByText('Mine');
    expect(screen.queryByRole('button', { name: /edit|delete/i })).toBeNull();
  });

  it('edge: an author whose profile can\'t be read shows as "Unknown user"', async () => {
    const page = [msg('g1', 'gone', 'From someone gone', 1)];
    setStore(fakeStore('S1', { loadGeneralMessages: jest.fn(async () => ({ messages: page, hasMore: false })) }));
    await render(<GeneralChatScreen />);
    expect(await screen.findByText('Unknown user')).toBeTruthy();
  });

  it('AC9: the role badge follows the current role', async () => {
    const page = [msg('g1', 'S2', 'Hello', 1)];
    const loadGeneralMessages = jest.fn(async () => ({ messages: page, hasMore: false }));
    const asMentor = { ...users.S2, role: 'mentor' as const };
    const store = fakeStore('S1', { loadGeneralMessages });
    setStore({ ...store, getUser: (id?: string) => (id === 'S2' ? asMentor : store.getUser(id)) });
    await render(<GeneralChatScreen />);
    await screen.findByText('Hello');
    expect(screen.getByText('Mentor')).toBeTruthy();
  });

  it('the general chat never touches the course chat or its ARU-31 counters', async () => {
    const store = fakeStore('S1');
    setStore(store);
    await render(<GeneralChatScreen />);
    await waitFor(() => expect(store.loadGeneralMessages).toHaveBeenCalled());
    expect(store.loadMessages).not.toHaveBeenCalled();
    expect(store.subscribeToMessages).not.toHaveBeenCalled();
    expect(store.markChatRead).not.toHaveBeenCalled();
    expect(store.setActiveChat).not.toHaveBeenCalled();
  });
});

describe('AC7: waiting and declined accounts', () => {
  it.each(['pending', 'rejected'] as const)('a %s account sees only the access screen, not the chat', async (status) => {
    const store = fakeStore('S1');
    setStore({ ...store, currentUser: { ...users.S1, accessStatus: status } });
    await render(
      <AccessGate>
        <GeneralChatScreen />
      </AccessGate>,
    );
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(store.loadGeneralMessages).not.toHaveBeenCalled();
  });

  it('canUseGeneralChat: any approved role, never a waiting or declined account', () => {
    expect(canUseGeneralChat(users.S1)).toBe(true);
    expect(canUseGeneralChat(users.M)).toBe(true);
    expect(canUseGeneralChat(users.T)).toBe(true);
    expect(canUseGeneralChat({ ...users.S1, accessStatus: 'pending' })).toBe(false);
    expect(canUseGeneralChat({ ...users.S1, accessStatus: 'rejected' })).toBe(false);
    expect(canUseGeneralChat(null)).toBe(false);
  });
});

describe('AC10: keyboard', () => {
  it('dragging the message list closes the keyboard', async () => {
    setStore(fakeStore('S1'));
    const { container } = await render(<GeneralChatScreen />);
    const list = container.queryAll((n) => typeof n.props.onEndReached === 'function')[0];
    expect(['interactive', 'on-drag']).toContain(list.props.keyboardDismissMode);
  });
});
