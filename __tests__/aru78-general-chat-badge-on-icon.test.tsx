// ARU-78: on Profile, the General chat badge sits over the chat icon's top-right corner with the ring, like the course
// card's chat icon (ARU-57). The course details Chat button and other buttons keep the badge at the right.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import { Button } from '@/components/ui';
import { colors } from '@/lib/theme';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const hidden = { includeHiddenElements: true };
const flat = (s: unknown) => StyleSheet.flatten(s as never);
const badgeStyle = () => flat(screen.getByTestId('unread-badge', hidden).props.style);
const counts = (c: Record<string, number>) => (id: string) => c[id] ?? 0;

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('Profile General chat badge (AC 1–AC 3)', () => {
  it.each(['S1', 'M', 'T'] as const)('%s: the badge is inside the icon box, on its top-right corner, with the ring', async (who) => {
    setStore(fakeStore(who, { generalUnreadCount: 3 }));
    await render(<ProfileScreen />);
    const box = screen.getByTestId('button-icon-box', hidden);
    expect(within(box).getByTestId('unread-badge', hidden)).toBeTruthy();
    expect(within(box).getByTestId('icon-chatbubble-outline', hidden)).toBeTruthy();
    expect(flat(box.props.style)).toMatchObject({ width: 24, height: 24 });
    const s = badgeStyle();
    // Centred on the corner of the 24 pt glyph: the 24 pt badge spans -10..14 from the corner, like on the card.
    expect(s).toMatchObject({ position: 'absolute', top: -10, right: -10 });
    expect(s.left).toBeUndefined(); // anchored by `right`, so "99+" grows inwards over the icon
    expect(s).toMatchObject({ height: 24, minWidth: 24, borderWidth: 2, borderColor: colors.card, backgroundColor: colors.primary });
  });

  it('same look as the course card badge (AC 2)', async () => {
    setStore(fakeStore('S1', { generalUnreadCount: 3 }));
    const view = await render(<ProfileScreen />);
    const profile = badgeStyle();
    await view.unmount();
    setStore(fakeStore('S1', { courses: [courseA], courseMembers: [member('A', 'S1')], unreadCount: counts({ A: 3 }) }));
    await render(<CoursesScreen />);
    const card = badgeStyle();
    const pick = ({ height, minWidth, borderRadius, borderWidth, borderColor, backgroundColor }: Record<string, unknown>) =>
      ({ height, minWidth, borderRadius, borderWidth, borderColor, backgroundColor });
    expect(pick(profile)).toEqual(pick(card));
  });

  it.each([
    [1, '1'],
    [9, '9'],
    [10, '10'],
    [99, '99'],
    [150, '99+'],
  ])('%s new: the whole text "%s" shows on one line (AC 3)', async (n, text) => {
    setStore(fakeStore('S1', { generalUnreadCount: n }));
    await render(<ProfileScreen />);
    const t = screen.getByText(text, hidden);
    expect(t.props.numberOfLines).toBe(1);
    expect(badgeStyle().width).toBeUndefined(); // no fixed width, so the pill grows with the text
  });
});

describe('AC 4–AC 6', () => {
  it('0 new: no badge, and the icon still sits in its box', async () => {
    setStore(fakeStore('S1', { generalUnreadCount: 0 }));
    await render(<ProfileScreen />);
    expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
    expect(screen.getByRole('button', { name: 'Open general chat' })).toBeTruthy();
  });

  it('the button keeps its look, label and tap; the badge takes no tap and isn\'t read', async () => {
    setStore(fakeStore('S1', { generalUnreadCount: 3 }));
    await render(<ProfileScreen />);
    const btn = screen.getByRole('button', { name: 'Open general chat, 3 new messages' });
    const style = flat(typeof btn.props.style === 'function' ? btn.props.style({ pressed: false }) : btn.props.style);
    expect(style).toMatchObject({ backgroundColor: colors.primarySoft, paddingVertical: 13, alignItems: 'center' });
    // The icon box keeps the plain icon's layout height (24 - 3 - 3), so the button height is unchanged.
    expect(flat(screen.getByTestId('button-icon-box', hidden).props.style)).toMatchObject({ marginVertical: -3 });
    const badge = screen.getByTestId('unread-badge', hidden);
    expect(badge.props.pointerEvents).toBe('none');
    expect(badge.props.accessibilityElementsHidden).toBe(true);
    expect(badge.props.importantForAccessibility).toBe('no-hide-descendants');
    await fireEvent.press(btn);
    expect(router.push).toHaveBeenCalledWith('/general-chat');
  });
});

describe('Other badges unchanged (AC 7)', () => {
  it('the course details Chat button keeps the badge at the right, without a ring', async () => {
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], unreadCount: counts({ A: 3 }) }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByTestId('button-icon-box', hidden)).toBeNull();
    const s = badgeStyle();
    expect(s).toMatchObject({ position: 'absolute', right: 12, top: 11, height: 20 });
    expect(s.borderWidth).toBeUndefined();
  });

  it('a button with unread and no icon keeps the badge at the right, even with badgeOnIcon', async () => {
    await render(<Button title="Chat" unread={2} badgeOnIcon onPress={() => {}} />);
    expect(screen.queryByTestId('button-icon-box', hidden)).toBeNull();
    expect(badgeStyle()).toMatchObject({ position: 'absolute', right: 12, top: 11 });
  });

  it('a button with an icon but no badgeOnIcon keeps the badge at the right', async () => {
    await render(<Button title="Open chat" icon="chatbubble-outline" unread={2} onPress={() => {}} />);
    expect(screen.queryByTestId('button-icon-box', hidden)).toBeNull();
    expect(badgeStyle()).toMatchObject({ position: 'absolute', right: 12, top: 11 });
  });
});
