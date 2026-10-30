// ARU-25 post-merge re-test (main after PRs #26–#28): cases the earlier dev and QA tests didn't cover.
// AC 1 layout (icon beside the text, content takes the remaining width, titles still 2 lines), AC 3 chat header
// title, AC 6 the icon appearing on a live add, and a teacher-owned course.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseChatScreen from '@/app/courses/[id]/chat';
import type { Course } from '@/lib/types';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

const screenOptions: { title?: string }[] = [];
jest.mock('expo-router', () => ({
  ...require('./helpers/mocks').expoRouter,
  Stack: { Screen: ({ options }: { options?: { title?: string } }) => (screenOptions.push(options ?? {}), null) },
}));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));

const longTitle = 'A very long course title that certainly needs more than two lines on a small phone screen';
const chatA = { name: 'Open chat for Algebra' };
const showAll = () => fireEvent.press(screen.getByRole('tab', { name: 'All courses' }));

beforeEach(() => {
  jest.clearAllMocks();
  screenOptions.length = 0;
});

describe('AC1: layout of a card with the icon', () => {
  it('the card is a centred row; the text column takes the remaining width so it never runs under the icon', async () => {
    setStore(fakeStore('S1', { courses: [courseA], courseMembers: [member('A', 'S1')] }));
    await render(<CoursesScreen />);
    const icon = screen.getByRole('button', chatA);
    const content = screen.getAllByRole('button', { name: /Algebra/ }).find((b) => b !== icon)!;
    expect(content).toBeTruthy();
    expect(StyleSheet.flatten(content.props.style)).toMatchObject({ flex: 1 });
    // The nearest ancestor of the icon laid out as a row is the card itself.
    let node = icon.parent;
    while (node && StyleSheet.flatten(node.props.style)?.flexDirection !== 'row') node = node.parent;
    const rowStyle = node ? StyleSheet.flatten(node.props.style) : undefined;
    expect(rowStyle).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
  });

  it('a long title and description still truncate to 2 lines next to the icon', async () => {
    const long: Course = { ...courseA, title: longTitle, description: `${longTitle} — description` };
    setStore(fakeStore('S1', { courses: [long], courseMembers: [member('A', 'S1')] }));
    await render(<CoursesScreen />);
    expect(screen.getByRole('button', { name: `Open chat for ${longTitle}` })).toBeTruthy();
    expect(screen.getByText(longTitle).props.numberOfLines).toBe(2);
    expect(screen.getByText(`${longTitle} — description`).props.numberOfLines).toBe(2);
  });
});

describe('AC3: the chat opened from the icon', () => {
  it('shows the course title in the header', async () => {
    params.id = 'A';
    setStore(fakeStore('S1', { courses: [courseA], courseMembers: [member('A', 'S1')] }));
    await render(<CourseChatScreen />);
    expect(screenOptions.map((o) => o.title)).toContain('Algebra');
  });
});

describe('AC6: live access changes in both directions', () => {
  it('being added as a listener shows the icon without reopening the tab', async () => {
    setStore(fakeStore('S2', { courses: [courseB, courseA], courseMembers: [] }));
    const view = await render(<CoursesScreen />);
    await showAll();
    expect(screen.queryByRole('button', chatA)).toBeNull();
    setStore(fakeStore('S2', { courses: [courseB, courseA], courseMembers: [member('A', 'S2')] }));
    await view.rerender(<CoursesScreen />);
    expect(screen.getByRole('button', chatA)).toBeTruthy();
  });
});

describe('AC1: teacher-owned course', () => {
  it('the teacher sees the icon on a course they own, under "Courses I own"', async () => {
    const owned: Course = { ...courseA, id: 'T1', title: 'Teaching', createdById: 'T' };
    setStore(fakeStore('T', { courses: [owned, courseB], courseMembers: [] }));
    await render(<CoursesScreen />);
    const card = screen.getByRole('button', { name: 'Open chat for Teaching' });
    expect(card).toBeTruthy();
    expect(within(screen.root!).queryByText('COURSES I OWN') ?? screen.queryByText(/COURSES I OWN/)).toBeTruthy();
  });
});
