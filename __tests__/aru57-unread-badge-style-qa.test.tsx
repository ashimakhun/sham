// QA ARU-57: gaps in aru57-unread-badge-style.test.tsx: the badge is drawn above the icon and the pressed circle,
// screen-reader labels are unchanged (AC 7), a "99+" pill fits inside the 44×44 target, and the hidden-course label,
// tag and title are untouched.
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import { CourseCard } from '@/components/CourseCard';
import { colors } from '@/lib/theme';
import type { Course } from '@/lib/types';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const members = [member('A', 'S1')];
const counts = (c: Record<string, number>) => (id: string) => c[id] ?? 0;
const hidden = { includeHiddenElements: true };

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

it('AC 7: labels are unchanged and the badge is never its own element', async () => {
  setStore(fakeStore('S1', { courses: [courseB, courseA], courseMembers: members, unreadCount: counts({ A: 150 }) }));
  await render(<CoursesScreen />);
  expect(screen.getByRole('button', { name: 'Open chat for Algebra, 99+ new messages' })).toBeTruthy();
  const badge = screen.getByTestId('unread-badge', hidden);
  expect(badge.props.accessibilityElementsHidden).toBe(true);
  expect(badge.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(screen.queryByText('99+')).toBeNull(); // hidden from accessibility queries
  expect(screen.getByText('99+', hidden)).toBeTruthy();
});

it('edge pressed state: the badge is drawn after the icon, so it stays on top of the pressed circle', async () => {
  setStore(fakeStore('S1', { courses: [courseA], courseMembers: members, unreadCount: counts({ A: 3 }) }));
  await render(<CourseCard course={courseA} />);
  const chat = screen.getByRole('button', { name: 'Open chat for Algebra, 3 new messages' });
  const kids = chat.children as unknown as { props: { testID?: string } }[];
  const last = kids[kids.length - 1];
  expect(within(chat).getByTestId('unread-badge', hidden)).toBeTruthy();
  expect(last.props.testID).toBe('unread-badge');
});

it('AC 5: a "99+" pill, anchored on the right, fits inside the 44×44 target (text width estimated generously)', async () => {
  setStore(fakeStore('S1', { courses: [courseA], courseMembers: members, unreadCount: counts({ A: 500 }) }));
  await render(<CourseCard course={courseA} />);
  const s = StyleSheet.flatten(screen.getByTestId('unread-badge', hidden).props.style);
  const text = StyleSheet.flatten(screen.getByText('99+', hidden).props.style);
  // 3 bold characters at 11 pt are under 0.7 em each.
  const width = 3 * 0.7 * (text.fontSize as number) + 2 * (s.paddingHorizontal as number) + 2 * (s.borderWidth as number);
  expect((s.right as number) + Math.max(width, s.minWidth as number)).toBeLessThanOrEqual(44);
  expect(s.borderColor).toBe(colors.card);
});

it('edge: a hidden course card for its owner keeps the title, the Hidden label and the Owner tag', async () => {
  const H: Course = { ...courseA, id: 'H', title: 'Secret '.repeat(12).trim(), hidden: true };
  setStore(fakeStore('M', { courses: [H], courseMembers: [], unreadCount: counts({ H: 42 }) }));
  await render(<CourseCard course={H} tag="Owner" />);
  expect(screen.getByText('Hidden')).toBeTruthy();
  expect(screen.getByText('Owner')).toBeTruthy();
  expect(screen.getByText(H.title).props.numberOfLines).toBe(2);
  expect(screen.getByText('42', hidden)).toBeTruthy();
});

it('AC 4 regression: the Chat button stays a secondary button (soft background, primary text)', async () => {
  setStore(fakeStore('S1', { courseMembers: members, unreadCount: counts({ A: 3 }) }));
  await render(<CourseDetailScreen />);
  const btn = screen.getByRole('button', { name: 'Chat, 3 new messages' });
  const bg = StyleSheet.flatten(typeof btn.props.style === 'function' ? btn.props.style({ pressed: false }) : btn.props.style);
  expect(bg.backgroundColor).toBe(colors.primarySoft);
  expect(StyleSheet.flatten(screen.getByText('Chat').props.style).color).toBe(colors.primary);
});
