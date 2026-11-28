// QA ARU-204: a Card with accessible={false} is no keyboard stop on the web (tabIndex -1, focusable false), but its
// own buttons still are, and a tap on the card still opens it. Side effect checked: the Materials post card (ARU-54)
// uses the same Card, so its title button must stay a keyboard stop and the card must still open the post.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import { CourseCard } from '@/components/CourseCard';
import { Card } from '@/components/ui';
import type { Material } from '@/lib/types';

import { courseA, fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
/** Host elements that take a click (react-native-web Pressables). */
function clickables(root: Node) {
  const out: Node[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as Node;
    if (typeof node.type === 'string' && typeof node.props?.onClick === 'function') out.push(node);
    node.children?.forEach(walk);
  };
  walk(root);
  return out;
}
const isStop = (n: Node) => n.props.tabIndex !== -1 && n.props.focusable !== false;

const post: Material = {
  id: 'P1',
  teacherId: 'T',
  title: 'Week one notes',
  body: 'Read **this** and see [the docs](https://example.com).',
  createdAt: '2026-10-20T10:00:00.000Z',
};

beforeEach(() => jest.clearAllMocks());

describe('ARU-204 QA · course card that fits (no Show description) is unchanged', () => {
  it.each(['N', 'S1'] as const)('%s: plain short card is still one grouped stop that opens the course', async (who) => {
    setStore(fakeStore(who));
    const { container } = await render(<CourseCard course={{ ...courseA, description: 'Short.' }} />);
    const stops = clickables(container as unknown as Node).filter(isStop);
    expect(stops).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show description' })).toBeNull();
  });
});

describe('ARU-204 QA · Card', () => {
  it('accessible={false}: not a keyboard stop, still opens on press', async () => {
    const onPress = jest.fn();
    const { container } = await render(
      <Card onPress={onPress} accessible={false} testID="c">
        <Text>Body</Text>
      </Card>,
    );
    const [card] = clickables(container as unknown as Node);
    expect(card.props.tabIndex).toBe(-1);
    expect(card.props.focusable).toBe(false);
    fireEvent.press(screen.getByTestId('c'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('grouped card (accessible not set) is unchanged: still one keyboard stop', async () => {
    const { container } = await render(
      <Card onPress={() => {}}>
        <Text>Body</Text>
      </Card>,
    );
    const [card] = clickables(container as unknown as Node);
    expect(isStop(card)).toBe(true);
  });
});

describe('ARU-204 QA · side effect on the Materials post card (ARU-54)', () => {
  it.each(['T', 'M', 'S1'] as const)('%s: the post title is a keyboard stop with role button, the card is not', async (who) => {
    setStore(fakeStore(who, { materials: [post] }));
    const { container } = await render(<MaterialsScreen />);
    const title = screen.getByRole('button', { name: 'Week one notes' });
    expect(title.props.tabIndex).not.toBe(-1);
    expect(title.props.focusable).not.toBe(false);
    const ungrouped = clickables(container as unknown as Node).filter((n) => n.props.accessible === false);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0].props.tabIndex).toBe(-1);
    // Every stop that takes a click is still reachable: title, link, like, and the tab's other controls.
    const stops = clickables(container as unknown as Node).filter(isStop);
    expect(stops.length).toBeGreaterThanOrEqual(2);
  });

  it('title press and a press on the body text still open the post', async () => {
    setStore(fakeStore('S1', { materials: [post] }));
    await render(<MaterialsScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Week one notes' }));
    fireEvent.press(screen.getByText('Week one notes'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/[id]', params: { id: 'P1' } });
  });
});
