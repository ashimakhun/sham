// ARU-100: the General chat button sits right below the name card, above Telegram, the Accountant section and the
// bottom button group, for every role; it is gone from the bottom group, which keeps its order.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import ProfileScreen from '@/app/(tabs)/profile';
import { resetTelegramCardCollapsedCache } from '@/components/TelegramCard';
import type { User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
  resetTelegramCardCollapsedCache();
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

async function renderProfile() {
  const view = await render(<ProfileScreen />);
  await act(async () => {});
  return view;
}

/** Position of the first occurrence of each marker in the rendered tree, in reading order. */
function positions(view: { toJSON: () => unknown }, markers: string[]) {
  const json = JSON.stringify(view.toJSON());
  return markers.map((m) => json.indexOf(m));
}

const chat = () => screen.getByRole('button', { name: /^Open general chat/ });

const accountant: User = { ...users.M, isAccountant: true };
const roles: [string, () => void, boolean][] = [
  ['student', () => setStore(fakeStore('S1')), false],
  ['mentor', () => setStore(fakeStore('M')), false],
  ['accountant mentor', () => setStore({ ...fakeStore('M'), currentUser: accountant }), true],
  ['teacher', () => setStore(fakeStore('T')), true],
];

it.each(roles)('AC 1 / AC 5: %s sees the chat button right after the name card, above every other section', async (_r, setup, billing) => {
  setup();
  const view = await renderProfile();
  const all = screen.getAllByRole('button');
  // The name card's only button is "Edit name"; the chat button comes straight after it.
  expect(all.indexOf(chat())).toBe(all.indexOf(screen.getByRole('button', { name: 'Edit name' })) + 1);
  const markers = ['Open general chat', 'TELEGRAM NOTIFICATIONS', ...(billing ? ['ACCOUNTANT'] : []), 'Change password'];
  const pos = positions(view, markers);
  expect(pos.every((p) => p >= 0)).toBe(true);
  expect(pos).toEqual([...pos].sort((a, b) => a - b));
});

it('AC 2: exactly one chat button, and the bottom group keeps its order (teacher)', async () => {
  setStore(fakeStore('T'));
  await renderProfile();
  expect(screen.getAllByRole('button', { name: /^Open general chat/ })).toHaveLength(1);
  const all = screen.getAllByRole('button');
  const idx = ['Manage roles', 'Change password', 'Sign out'].map((n) => all.indexOf(screen.getByRole('button', { name: new RegExp(`^${n}`) })));
  expect(idx).toEqual([...idx].sort((a, b) => a - b));
  expect(idx[2]).toBe(all.length - 1);
  expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
});

it('AC 2: student bottom group is Change password, Sign out, Delete account last; chat before all of them', async () => {
  setStore(fakeStore('S1'));
  await renderProfile();
  const all = screen.getAllByRole('button');
  const idx = ['Change password', 'Sign out', 'Delete account'].map((n) => all.indexOf(screen.getByRole('button', { name: n })));
  expect(idx).toEqual([...idx].sort((a, b) => a - b));
  expect(idx[2]).toBe(all.length - 1);
  expect(all.indexOf(chat())).toBeLessThan(idx[0]);
});

it('AC 3: the label carries the unread count (3 and 99+)', async () => {
  setStore({ ...fakeStore('S1'), generalUnreadCount: 3 });
  const view = await renderProfile();
  expect(screen.getByRole('button', { name: 'Open general chat, 3 new messages' })).toBeTruthy();
  await view.unmount();
  setStore({ ...fakeStore('S1'), generalUnreadCount: 120 });
  await renderProfile();
  expect(screen.getByRole('button', { name: /^Open general chat, 99\+/ })).toBeTruthy();
});

it('AC 4: tapping it opens the general chat', async () => {
  setStore(fakeStore('M'));
  await renderProfile();
  fireEvent.press(chat());
  expect(router.push).toHaveBeenCalledWith('/general-chat');
});

it('edge: Telegram not configured — the chat button sits directly above the bottom group (student)', async () => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
  setStore(fakeStore('S1'));
  await renderProfile();
  expect(screen.queryByText('TELEGRAM NOTIFICATIONS')).toBeNull();
  const all = screen.getAllByRole('button');
  expect(all.indexOf(screen.getByRole('button', { name: 'Change password' }))).toBe(all.indexOf(chat()) + 1);
});

it('AC 6: the button is a direct section of the scroll content (no extra wrapper margin)', async () => {
  setStore(fakeStore('S1'));
  const view = await renderProfile();
  type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
  const scroll = view.toJSON() as Node;
  // RCTScrollView > content container View > sections.
  const container = (scroll.children ?? [])[0] as Node;
  const sections = (container.children ?? []).filter((c): c is Node => typeof c !== 'string');
  const hit = sections.find((c) => String(c.props.accessibilityLabel ?? '').startsWith('Open general chat'));
  expect(hit).toBeTruthy();
  expect(sections.indexOf(hit!)).toBe(1);
});
