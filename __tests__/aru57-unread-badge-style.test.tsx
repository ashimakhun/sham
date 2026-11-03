// ARU-57: the new-message badge sits over the chat icon's top-right corner in the button colour, with a card-coloured
// ring on the card icon; the course details Chat button only changes colour.
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import { colors } from '@/lib/theme';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courses = [courseB, courseA];
const members = [member('A', 'S1'), member('A', 'M2')];
const counts = (c: Record<string, number>) => (id: string) => c[id] ?? 0;
const hidden = { includeHiddenElements: true };
const badgeStyle = () => StyleSheet.flatten(screen.getByTestId('unread-badge', hidden).props.style);

// The chat target is 44×44 with the 24 pt icon centred in it, so the icon spans 10–34 on both axes.
const TARGET = 44;
const ICON_MIN = 10;
const ICON_MAX = 34;

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('course card icon', () => {
  it.each([1, 9, 10, 99, 150])('count %s: button colour, white number, card ring, never intercepts the tap', async (n) => {
    setStore(fakeStore('S1', { courses, courseMembers: members, unreadCount: counts({ A: n }) }));
    await render(<CoursesScreen />);
    const badge = screen.getByTestId('unread-badge', hidden);
    const style = badgeStyle();
    expect(style.backgroundColor).toBe(colors.primary);
    expect(style.backgroundColor).not.toBe(colors.danger);
    expect(style.borderColor).toBe(colors.card);
    expect(style.borderWidth).toBeGreaterThan(0);
    expect(badge.props.pointerEvents).toBe('none');
    const text = screen.getByText(n > 99 ? '99+' : String(n), hidden);
    expect(StyleSheet.flatten(text.props.style).color).toBe('#fff');
  });

  it('is centred over the icon\'s top-right corner and stays inside the 44×44 target', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members, unreadCount: counts({ A: 3 }) }));
    await render(<CoursesScreen />);
    const style = badgeStyle();
    expect(style.position).toBe('absolute');
    const size = style.height as number;
    const top = style.top as number;
    const right = style.right as number;
    // Anchored by right, so wider pills grow inwards (AC 5) and never past the target or the card.
    expect(style.left).toBeUndefined();
    expect(top).toBeGreaterThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(0);
    const centreX = TARGET - right - size / 2;
    const centreY = top + size / 2;
    // The centre sits within a few points of the icon's top-right corner, inside the icon's box (AC 1).
    expect(Math.abs(centreX - ICON_MAX)).toBeLessThanOrEqual(4);
    expect(Math.abs(centreY - ICON_MIN)).toBeLessThanOrEqual(4);
    expect(centreX).toBeLessThanOrEqual(ICON_MAX);
    expect(centreY).toBeGreaterThanOrEqual(ICON_MIN);
  });

  it('0 new messages: no badge', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members, unreadCount: counts({}) }));
    await render(<CoursesScreen />);
    expect(screen.queryByTestId('unread-badge', hidden)).toBeNull();
    expect(screen.getByRole('button', { name: 'Open chat for Algebra' })).toBeTruthy();
  });
});

describe('Chat button on course details (AC 4)', () => {
  it('only the colour changes: button colour, no ring, same place', async () => {
    setStore(fakeStore('S1', { courseMembers: members, unreadCount: counts({ A: 3 }) }));
    await render(<CourseDetailScreen />);
    expect(screen.getByRole('button', { name: 'Open chat for Algebra, 3 new messages' })).toBeTruthy();
    const style = badgeStyle();
    expect(style.backgroundColor).toBe(colors.primary);
    expect(style.borderWidth).toBeUndefined();
    expect(style).toMatchObject({ position: 'absolute', right: 12, top: 11, height: 20 });
  });
});
