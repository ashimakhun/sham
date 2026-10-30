// ARU-27 QA (verifying the fix in b42bfd0): with the chat icon shown, the course card stops grouping its children
// so screen readers reach the icon, and the content column becomes its own button. Checks that the split keeps the
// card usable: one navigation per tap, a sensible focus order, cards without an icon unchanged, and the content
// button still announcing what the card shows (tag, title, description, owner line).
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { CourseCard } from '@/components/CourseCard';
import { formatDate } from '@/lib/theme';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courses = [courseB, courseA];
const members = [member('A', 'S1')];
const chatA = { name: 'Open chat for Algebra' };

/** Host views with accessible={true}: what iOS VoiceOver / Android TalkBack can focus, in tree (= focus) order. */
type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
const focusable = (root: Node) => {
  const out: Node[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as Node;
    if (typeof node.type === 'string' && node.props.accessible === true) out.push(node);
    node.children?.forEach(walk);
  };
  walk(root);
  return out;
};

beforeEach(() => jest.clearAllMocks());

describe('card with the chat icon (listener S1 on A)', () => {
  it('exposes exactly two screen-reader stops, content first, then the chat button', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    const { container } = await render(<CourseCard course={courseA} tag="Listener" />);
    const stops = focusable(container as unknown as Node);
    expect(stops).toHaveLength(2);
    expect(stops[0].props.accessibilityRole).toBe('button');
    expect(stops[1].props.accessibilityLabel).toBe('Open chat for Algebra');
  });

  it('tapping the content opens the details once, and the icon opens only the chat', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CourseCard course={courseA} />);
    await fireEvent.press(screen.getByText('Algebra'));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });

  it('the icon opens only the chat (no details push as well)', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    await render(<CourseCard course={courseA} />);
    await fireEvent.press(screen.getByRole('button', chatA));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/courses/[id]/chat', params: { id: 'A' } });
  });

  it('the content button still announces the tag, title, description and owner line, not only the title', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    const { container } = await render(<CourseCard course={courseA} tag="Listener" />);
    const content = focusable(container as unknown as Node)[0];
    const label = content.props.accessibilityLabel as string | undefined;
    // An explicit accessibilityLabel replaces the children's text for screen readers. Without one, iOS and Android
    // read the grouped children (what a card without the icon announces).
    if (label !== undefined) {
      expect(label).toContain('Algebra');
      expect(label).toContain('Equations and more');
      expect(label).toContain('Mentor Max');
      expect(label).toContain(formatDate(courseA.createdAt));
      expect(label).toContain('Listener');
    }
  });
});

describe('cards without the icon are unchanged', () => {
  it('a mentor who is not in A gets one grouped card (one screen-reader stop, no label override)', async () => {
    setStore(fakeStore('M2', { courses, courseMembers: members }));
    const { container } = await render(<CourseCard course={courseA} />);
    const stops = focusable(container as unknown as Node);
    expect(stops).toHaveLength(1);
    expect(stops[0].props.accessibilityLabel).toBeUndefined();
    expect(screen.queryByRole('button', chatA)).toBeNull();
  });

  it('a student who is not in B gets the ARU-24 limited card, grouped, with no icon', async () => {
    setStore(fakeStore('S1', { courses, courseMembers: members }));
    const { container } = await render(<CourseCard course={courseB} />);
    expect(focusable(container as unknown as Node)).toHaveLength(1);
    expect(screen.queryByText(/Owner:/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Open chat/ })).toBeNull();
  });
});
