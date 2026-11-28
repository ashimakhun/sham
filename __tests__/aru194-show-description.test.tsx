// ARU-194: a "Show description" button on a course card whose description is cut short at 2 lines opens the full
// description in a pop-up. Layout events don't fire in Jest, so the tests fire them by hand: the clamped preview's
// height against the hidden, unclamped copy's height.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AccessibilityInfo } from 'react-native';

import { CourseCard } from '@/components/CourseCard';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import type { Course } from '@/lib/types';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const LONG = 'Line one of the course.\n\nSecond paragraph that goes on and on, well past two lines on any phone.';
const longCourse: Course = { ...courseA, description: LONG };
const showLabel = { name: 'Show description' };
const hidden = { includeHiddenElements: true };

const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height } } });
/** Fires the two layout events: `full` is the unclamped copy's height, `clamped` the 2-line preview's. */
async function measure(clamped: number, full: number) {
  await fireEvent(screen.getByTestId('course-description-preview', hidden), 'layout', layout(clamped));
  await fireEvent(screen.getByTestId('course-description-measure', hidden), 'layout', layout(full));
}

/** The pop-up's Modal element (the nearest ancestor of the sheet with the Modal's handlers). */
function modalHandlers() {
  type El = { props: Record<string, unknown>; parent: El | null };
  let node = screen.getByTestId('course-description-dialog') as unknown as El | null;
  while (node && typeof node.props.onRequestClose !== 'function') node = node.parent;
  if (!node) throw new Error('no Modal');
  return node.props as { onRequestClose: () => void; onShow: () => void };
}
const isOpen = () => screen.queryByTestId('course-description-dialog') !== null;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('AC 1: shown only when cut short', () => {
  it('a description taller than 2 lines gets the button', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    expect(screen.queryByRole('button', showLabel)).toBeNull();
    await measure(44, 110);
    expect(screen.getByRole('button', showLabel)).toBeTruthy();
    expect(screen.getByText('Show description')).toBeTruthy();
  });

  it('exactly 2 lines (same height, or sub-pixel rounding) gets no button', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 44.5);
    expect(screen.queryByRole('button', showLabel)).toBeNull();
  });

  it('a 1-line description gets no button', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={courseA} />);
    await measure(22, 22);
    expect(screen.queryByRole('button', showLabel)).toBeNull();
  });

  it('no description: no preview and no button', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={{ ...courseA, description: '' }} />);
    expect(screen.queryByTestId('course-description-preview', hidden)).toBeNull();
    expect(screen.queryByRole('button', showLabel)).toBeNull();
  });

  it('follows a new layout (rotation, resize, text size): the button appears and disappears', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 66);
    expect(screen.getByRole('button', showLabel)).toBeTruthy();
    await measure(44, 44);
    expect(screen.queryByRole('button', showLabel)).toBeNull();
  });

  it('the measuring copy is hidden from screen readers', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    expect(screen.queryByTestId('course-description-measure')).toBeNull();
    expect(screen.getByTestId('course-description-measure', hidden)).toBeTruthy();
  });

  it('Russian: «Показать описание»', async () => {
    setStore(fakeStore('T', { currentUser: { ...users.T, language: 'ru' } }));
    await render(
      <LanguageProvider>
        <CourseCard course={longCourse} />
      </LanguageProvider>,
    );
    await act(async () => {});
    await measure(44, 110);
    expect(screen.getByText('Показать описание')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Показать описание' })).toBeTruthy();
  });
});

describe('AC 2–4: the pop-up', () => {
  it('opens with the title as heading and the full text; the course does not open', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    await fireEvent.press(screen.getByRole('button', showLabel));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Algebra' })).toBeTruthy();
    expect(screen.getByTestId('course-description-full')).toHaveTextContent(LONG, { exact: true, normalizer: (t) => t });
    expect(screen.getByTestId('course-description-full').props.numberOfLines).toBeUndefined();
  });

  it('closes with Close, with a tap outside and with onRequestClose (Android back, Escape on web)', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    expect(isOpen()).toBe(false);
    await fireEvent.press(screen.getByRole('button', showLabel));
    expect(isOpen()).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(isOpen()).toBe(false);

    await fireEvent.press(screen.getByRole('button', showLabel));
    await fireEvent.press(screen.getByTestId('course-description-backdrop', hidden));
    expect(isOpen()).toBe(false);

    await fireEvent.press(screen.getByRole('button', showLabel));
    await act(async () => modalHandlers().onRequestClose());
    expect(isOpen()).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('the pop-up is outside the card, so a tap inside it never opens the course', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    await fireEvent.press(screen.getByRole('button', showLabel));
    await fireEvent.press(screen.getByTestId('course-description-full'));
    await fireEvent.press(screen.getByRole('header', { name: 'Algebra' }));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('Russian Close: «Закрыть»', async () => {
    setStore(fakeStore('T', { currentUser: { ...users.T, language: 'ru' } }));
    await render(
      <LanguageProvider>
        <CourseCard course={longCourse} />
      </LanguageProvider>,
    );
    await act(async () => {});
    await measure(44, 110);
    await fireEvent.press(screen.getByRole('button', { name: 'Показать описание' }));
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeTruthy();
  });
});

describe('AC 5: the card still works', () => {
  it('plain card: tapping the title or the owner line opens the course; right after closing the pop-up too', async () => {
    setStore(fakeStore('N')); // not in the chat: a plain card
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    await fireEvent.press(screen.getByRole('button', showLabel));
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    // No tap guard after the pop-up: Show description never goes through open().
    await fireEvent.press(screen.getByText('Algebra'));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });

  it('tapping the owner line still opens the course', async () => {
    setStore(fakeStore('N')); // not in the chat: a plain card
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    await fireEvent.press(screen.getByText(/Mentor Max/, hidden));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });

  it('chat card: the chat icon still opens the chat; Show description opens only the pop-up', async () => {
    setStore(fakeStore('S1', { courses: [longCourse], courseMembers: [member('A', 'S1')] }));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    await fireEvent.press(screen.getByRole('button', showLabel));
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open chat for Algebra' }));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/courses/[id]/chat', params: { id: 'A' } });
  });
});

describe('AC 6: everyone who sees the card', () => {
  it.each([
    ['teacher', 'T'],
    ['mentor', 'M'],
    ['listener student', 'S1'],
    ['student who is not a listener (summary only, ARU-24)', 'S2'],
  ] as const)('%s gets the button', async (_, who) => {
    setStore(fakeStore(who, { courses: [longCourse], courseMembers: [member('A', 'S1')] }));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    expect(screen.getByRole('button', showLabel)).toBeTruthy();
  });

  it('a hidden course (teacher, Hidden badge) gets the button too', async () => {
    const hiddenCourse = { ...longCourse, hidden: true };
    setStore(fakeStore('T', { courses: [hiddenCourse] }));
    await render(<CourseCard course={hiddenCourse} />);
    await measure(44, 110);
    expect(screen.getByRole('button', showLabel)).toBeTruthy();
  });
});

describe('AC 7: up to date', () => {
  it('an edited description shows on the card and in the pop-up; shortened to 1 line, the button goes', async () => {
    setStore(fakeStore('T'));
    const view = await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    const edited = `${LONG}\nEdited.`;
    await view.rerender(<CourseCard course={{ ...longCourse, description: edited }} />);
    await fireEvent.press(screen.getByRole('button', showLabel));
    expect(screen.getByTestId('course-description-full')).toHaveTextContent(edited, { exact: true, normalizer: (t) => t });
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));

    await view.rerender(<CourseCard course={{ ...longCourse, description: 'Short.' }} />);
    await measure(22, 22);
    expect(screen.queryByRole('button', showLabel)).toBeNull();
  });
});

describe('AC 8: accessible', () => {
  type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
  const focusable = (root: Node) => {
    const out: Node[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const node = n as Node;
      if (node.props?.importantForAccessibility === 'no-hide-descendants') return;
      if (typeof node.type === 'string' && node.props.accessible === true) out.push(node);
      node.children?.forEach(walk);
    };
    walk(root);
    return out;
  };

  it('plain card: the content and Show description are separate screen reader stops; the content reads it all', async () => {
    // Mentor Nina isn't in Algebra's chat, so the card has no chat icon.
    setStore(fakeStore('N'));
    const { container } = await render(<CourseCard course={longCourse} tag="Listener" />);
    await measure(44, 110);
    const stops = focusable(container as unknown as Node);
    expect(stops.map((n) => n.props.accessibilityLabel)).toEqual([
      expect.stringContaining('Algebra'),
      'Show description',
    ]);
    const label = stops[0].props.accessibilityLabel as string;
    expect(label).toContain('Listener');
    expect(label).toContain(LONG);
    expect(label).toContain('Mentor Max');
    expect(stops[1].props.accessibilityRole).toBe('button');
  });

  it('chat card: content, Show description, then the chat icon', async () => {
    setStore(fakeStore('S1', { courses: [longCourse], courseMembers: [member('A', 'S1')] }));
    const { container } = await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    const labels = focusable(container as unknown as Node).map((n) => n.props.accessibilityLabel);
    expect(labels).toEqual([
      expect.stringContaining('Algebra'),
      'Show description',
      'Open chat for Algebra',
    ]);
  });

  it('summary-only student: no owner line in the content label', async () => {
    setStore(fakeStore('S2', { courses: [longCourse] }));
    const { container } = await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    expect(focusable(container as unknown as Node)[0].props.accessibilityLabel).not.toContain('Mentor Max');
  });

  it('the button is at least 44 × 44 pt', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    const button = screen.getByTestId('course-show-description');
    const style = [button.props.style].flat(5).reduce((a, b) => ({ ...a, ...b }), {});
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });

  it('closing sends focus back to the Show description button', async () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    await fireEvent.press(screen.getByRole('button', showLabel));
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await act(async () => jest.advanceTimersByTime(400));
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'focus');
    spy.mockRestore();
  });

  it('the heading is focused when the pop-up shows', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    await fireEvent.press(screen.getByRole('button', showLabel));
    await act(async () => modalHandlers().onShow());
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'focus');
    spy.mockRestore();
  });

  it('the backdrop is not a screen reader stop, so the heading is read first', async () => {
    setStore(fakeStore('T'));
    await render(<CourseCard course={longCourse} />);
    await measure(44, 110);
    await fireEvent.press(screen.getByRole('button', showLabel));
    expect(screen.getByTestId('course-description-backdrop', hidden).props.accessible).toBe(false);
  });
});
