// ARU-25 QA additions to aru25-course-card-chat-icon.test.tsx, from the TEST DESIGN: screen-reader reachability and
// touch target of the icon (AC 7), the ARU-24 limited card staying icon-free and unchanged (AC 2), the icon in
// "Courses I own", the tap guard not blocking a later tap, and the chat screen's denied state on a stale tap (AC 6).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseChatScreen from '@/app/courses/[id]/chat';
import { CourseCard } from '@/components/CourseCard';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courses = [courseB, courseA];
const members = [member('A', 'S1'), member('A', 'M2')];
const chatA = { name: 'Open chat for Algebra' };
const showAll = () => fireEvent.press(screen.getByRole('tab', { name: 'All courses' }));

beforeEach(() => jest.clearAllMocks());

describe('AC7: accessibility', () => {
  it('the icon is a separate accessibility element (no accessible ancestor groups it away from screen readers)', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CourseCard course={courseA} />);
    const icon = screen.getByRole('button', chatA);
    // On iOS a view with accessible={true} groups all its children into one element, so VoiceOver can't focus a
    // button inside it. Pressable is accessible by default; the card must opt out (or expose the chat as an action).
    const groupingAncestors: string[] = [];
    for (let node = icon.parent; node; node = node.parent) {
      if (typeof node.type === 'string' && node.props.accessible === true) {
        groupingAncestors.push(String(node.props.accessibilityLabel ?? node.props.accessibilityRole ?? node.type));
      }
    }
    expect(groupingAncestors).toEqual([]);
  });

  it('the icon has a touch target of at least 44×44 pt', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CourseCard course={courseA} />);
    const style = StyleSheet.flatten(screen.getByRole('button', chatA).props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  });
});

describe('AC2 with ARU-24: limited cards stay icon-free and unchanged', () => {
  it('a student who is not in B sees the title-only limited card for B with no icon and no row layout', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CourseCard course={courseB} />);
    expect(screen.getByText('Biology')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open chat/ })).toBeNull();
    expect(screen.queryByText(/Owner:/)).toBeNull();
    expect(screen.queryByTestId('icon-chatbubble-outline')).toBeNull();
  });

  it('a mentor who is neither owner nor listener sees the full card for A but no icon', async () => {
    setStore(fakeStore('N', { courses, courseMembers: members }));
    await render(<CourseCard course={courseA} />);
    expect(screen.getByText(/Owner:/)).toBeTruthy();
    expect(screen.queryByRole('button', chatA)).toBeNull();
  });
});

describe('AC1: owner view', () => {
  it('the owner sees the icon on A under "Courses I own" in My courses', async () => {
    setStore(fakeStore('M', { courses, courseMembers: members }));
    await render(<CoursesScreen />);
    expect(screen.getByText(/COURSES I OWN/)).toBeTruthy();
    expect(screen.getByRole('button', chatA)).toBeTruthy();
  });
});

describe('AC3/AC5: tap guard', () => {
  it('after the guard window, the card still opens the details', async () => {
    const now = jest.spyOn(Date, 'now');
    try {
      setStore(fakeStore('S1', { courses, courseMembers: members }));
      await render(<CoursesScreen />);
      await showAll();
      now.mockReturnValue(10_000);
      await fireEvent.press(screen.getByRole('button', chatA));
      now.mockReturnValue(11_000);
      await fireEvent.press(screen.getAllByText('Algebra')[0]);
      expect(router.push).toHaveBeenCalledTimes(2);
      expect(router.push).toHaveBeenLastCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
    } finally {
      now.mockRestore();
    }
  });
});

describe('AC6: stale tap', () => {
  it('opening the chat after losing access shows "You are no longer in this course" and no input', async () => {
    params.id = 'A';
    setStore(fakeStore('S1', { courses, courseMembers: [member('A', 'M2')] }));
    await act(async () => {
      await render(<CourseChatScreen />);
    });
    expect(screen.getByText('You are no longer in this course')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/message/i)).toBeNull();
  });
});
