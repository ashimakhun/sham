// ARU-69: the course details and Profile chat buttons show the chat icon instead of "Chat" / "General chat".
// M owns A; S1 is a listener of A; N and S2 are not in A; teacher T.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import CourseDetailScreen from '@/app/courses/[id]';
import { colors } from '@/lib/theme';

import { fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const members = [member('A', 'S1')];
const hidden = { includeHiddenElements: true };
const counts = (c: Record<string, number>) => (id: string) => c[id] ?? 0;
type Node = { props: Record<string, unknown>; children?: unknown[] };
/** The chat glyph rendered inside a button, if any (walks the element's children). */
function iconIn(btn: unknown): Node {
  const walk = (n: unknown): Node | undefined => {
    if (!n || typeof n !== 'object') return undefined;
    const node = n as Node;
    if (node.props?.testID === 'icon-chatbubble-outline') return node; // jest.setup.js mocks Ionicons this way
    for (const c of node.children ?? []) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(btn) as Node;
}
const styleOf = (btn: ReturnType<typeof screen.getByRole>) =>
  StyleSheet.flatten(typeof btn.props.style === 'function' ? btn.props.style({ pressed: false }) : btn.props.style);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

// ARU-96: course details no longer has a chat button; the course card keeps the chat icon.
describe('course details (ARU-96)', () => {
  it.each(['T', 'M', 'S1', 'N', 'S2'] as const)('%s has no chat button on course details', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, unreadCount: counts({ A: 5 }) }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: /^Open chat for/ })).toBeNull();
    expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
  });
});

describe('AC2/AC3/AC5: Profile', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees the chat icon labelled "Open general chat" (no text); it opens General chat', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    const btn = screen.getByRole('button', { name: 'Open general chat' });
    expect(iconIn(btn)).toBeTruthy();
    expect(screen.queryByText('General chat')).toBeNull();
    expect(styleOf(btn).backgroundColor).toBe(colors.primarySoft);
    expect(screen.queryByTestId('unread-badge', hidden)).toBeNull(); // no count until ARU-72
    await fireEvent.press(btn);
    expect(router.push).toHaveBeenCalledWith('/general-chat');
  });

  it('a waiting account has no General chat button', async () => {
    const store = fakeStore('S1');
    setStore({ ...store, currentUser: { ...users.S1, accessStatus: 'pending' } });
    await render(<ProfileScreen />);
    expect(screen.queryByRole('button', { name: 'Open general chat' })).toBeNull();
  });
});

describe('AC6: other buttons keep their text', () => {
  it('Manage roles and Sign out are text buttons', async () => {
    setStore(fakeStore('T'));
    await render(<ProfileScreen />);
    expect(screen.getByText('Manage roles')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('Change owner stays a text button on course details', async () => {
    setStore(fakeStore('T', { courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Change owner')).toBeTruthy();
  });
});
