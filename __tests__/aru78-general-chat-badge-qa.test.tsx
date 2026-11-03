// QA ARU-78: gaps in aru78-general-chat-badge-on-icon.test.tsx: the badge's offset from the icon's corner equals the
// course card's (computed from the card's 44 pt target and centred 24 pt icon, not hard-coded), the ring colour differs
// from the button's primarySoft background, and a live count going 0 → 5 → 0 moves the badge in and out on the icon.
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import ProfileScreen from '@/app/(tabs)/profile';
import { styles } from '@/components/ui';
import { colors } from '@/lib/theme';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const hidden = { includeHiddenElements: true };
const flat = (s: unknown) => StyleSheet.flatten(s as never) as Record<string, number | string | undefined>;

it('AC 1: the badge sits at the same offset from the icon\'s top-right corner as on the course card', async () => {
  setStore(fakeStore('S1', { courses: [courseA], courseMembers: [member('A', 'S1')], unreadCount: () => 3 }));
  const card = await render(<CoursesScreen />);
  const chat = screen.getByRole('button', { name: /^Open chat for Algebra/ });
  const target = flat(chat.props.style);
  const cardBadge = flat(within(chat).getByTestId('unread-badge', hidden).props.style);
  const iconSize = 24;
  const inset = ((target.width as number) - iconSize) / 2; // the icon is centred in the target
  const cardOffset = { top: (cardBadge.top as number) - inset, right: (cardBadge.right as number) - inset };
  await card.unmount();

  setStore(fakeStore('S1', { generalUnreadCount: 3 }));
  await render(<ProfileScreen />);
  const box = screen.getByTestId('button-icon-box', hidden);
  expect(flat(box.props.style)).toMatchObject({ width: iconSize, height: iconSize });
  const badge = flat(within(box).getByTestId('unread-badge', hidden).props.style);
  expect({ top: badge.top, right: badge.right }).toEqual(cardOffset);
});

it('AC 2: the ring colour stands out from the secondary button\'s background', () => {
  expect(flat(styles.unreadRing).borderColor).toBe(colors.card);
  expect(colors.card).not.toBe(colors.primarySoft);
});

it('AC 4 / AC 8: a live count 0 → 5 → 0 shows and removes the badge on the icon; the label follows', async () => {
  setStore(fakeStore('M', { generalUnreadCount: 0 }));
  const view = await render(<ProfileScreen />);
  expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
  expect(screen.getByRole('button', { name: 'Open general chat' })).toBeTruthy();

  setStore(fakeStore('M', { generalUnreadCount: 5 }));
  await view.rerender(<ProfileScreen />);
  expect(within(screen.getByTestId('button-icon-box', hidden)).getByTestId('unread-badge', hidden)).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Open general chat, 5 new messages$/ })).toBeTruthy();

  setStore(fakeStore('M', { generalUnreadCount: 0 }));
  await view.rerender(<ProfileScreen />);
  expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
  expect(screen.getByTestId('button-icon-box', hidden)).toBeTruthy();
});
