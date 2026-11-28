// ARU-194 QA: extra checks for the "Show description" button.
// On a real device and in the browser, the 2-line preview and its hidden, unclamped copy are laid out in the same pass,
// so their two onLayout events reach React in one batch (react-native-web: one ResizeObserver callback; native: one
// layout commit). The developer's tests fire them one at a time, with a re-render in between. These tests fire them in
// one batch (one act()), as the platforms do.
import { act, render, screen } from '@testing-library/react-native';

import { CourseCard } from '@/components/CourseCard';
import type { Course } from '@/lib/types';

import { courseA, fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const LONG = 'Line one of the course.\n\nSecond paragraph that goes on and on, well past two lines on any phone.';
const longCourse: Course = { ...courseA, description: LONG };
const showLabel = { name: 'Show description of Algebra' };
const hidden = { includeHiddenElements: true };

const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height } } });
type LayoutProps = { onLayout: (e: ReturnType<typeof layout>) => void };

/** Both layout events in one batch, in the given order (no re-render in between). */
async function measureTogether(clamped: number, full: number, order: 'clamped-first' | 'full-first' = 'clamped-first') {
  const preview = screen.getByTestId('course-description-preview', hidden).props as LayoutProps;
  const copy = screen.getByTestId('course-description-measure', hidden).props as LayoutProps;
  await act(async () => {
    if (order === 'clamped-first') {
      preview.onLayout(layout(clamped));
      copy.onLayout(layout(full));
    } else {
      copy.onLayout(layout(full));
      preview.onLayout(layout(clamped));
    }
  });
}

/** One layout event at a time (a re-render in between), as in the developer's tests. */
async function measureApart(clamped: number, full: number) {
  await act(async () => {
    (screen.getByTestId('course-description-preview', hidden).props as LayoutProps).onLayout(layout(clamped));
  });
  await act(async () => {
    (screen.getByTestId('course-description-measure', hidden).props as LayoutProps).onLayout(layout(full));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ARU-194 QA · AC 1: shown only when cut short (layout events in one batch)', () => {
  it.each(['clamped-first', 'full-first'] as const)(
    'first layout of a 5-line description (%s) shows the button',
    async (order) => {
      setStore(fakeStore('T'));
      await render(<CourseCard course={longCourse} />);
      await measureTogether(44, 110, order);
      expect(screen.getByRole('button', showLabel)).toBeTruthy();
    },
  );

  it('first layout of a 1-line description shows no button', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={courseA} />);
    await measureTogether(22, 22);
    expect(screen.queryByRole('button', showLabel)).toBeNull();
  });

  it('rotation / resize: 1 line becomes exactly 2 lines → still no button', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measureApart(22, 22); // wide window: 1 line
    expect(screen.queryByRole('button', showLabel)).toBeNull();
    await measureTogether(44, 44); // narrow window: exactly 2 lines, both heights change in the same pass
    expect(screen.queryByRole('button', showLabel)).toBeNull();
  });

  it('edit (AC 7): 5 lines shortened to 1 line → the button goes, whatever order the events come in', async () => {
    setStore(fakeStore('T'));
    const view = await render(<CourseCard course={longCourse} />);
    await measureApart(44, 110);
    expect(screen.getByRole('button', showLabel)).toBeTruthy();
    await view.rerender(<CourseCard course={{ ...longCourse, description: 'Short.' }} />);
    await measureTogether(22, 22, 'full-first');
    expect(screen.queryByRole('button', showLabel)).toBeNull();
  });
});

describe('ARU-194 QA · AC 8: nothing hidden from screen readers is a keyboard stop', () => {
  type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
  /** Host elements that take a press but are hidden from screen readers. */
  function hiddenPressables(root: Node) {
    const out: Node[] = [];
    const walk = (n: unknown, inHidden: boolean) => {
      if (!n || typeof n !== 'object') return;
      const node = n as Node;
      const hiddenHere =
        inHidden ||
        node.props?.importantForAccessibility === 'no-hide-descendants' ||
        node.props?.accessibilityElementsHidden === true ||
        node.props?.['aria-hidden'] === true;
      if (typeof node.type === 'string' && hiddenHere && typeof node.props.onClick === 'function') out.push(node);
      node.children?.forEach((c) => walk(c, hiddenHere));
    };
    walk(root, false);
    return out;
  }

  it('the owner line / rating part (hidden from screen readers) is not focusable (web: no tab stop with no name)', async () => {
    setStore(fakeStore('N')); // plain card with an owner line
    const { container } = await render(<CourseCard course={longCourse} />);
    await measureApart(44, 110);
    const pressables = hiddenPressables(container as unknown as Node);
    expect(pressables.length).toBeGreaterThan(0);
    for (const p of pressables) {
      // react-native-web's Pressable renders tabIndex 0 unless tabIndex={-1} is passed (focusable={false} isn't enough
      // there), so an aria-hidden Pressable is still reached with Tab and read as nothing (axe: aria-hidden-focus).
      expect(p.props.tabIndex).toBe(-1);
    }
  });
});
