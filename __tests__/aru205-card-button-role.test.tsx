// ARU-205: a card that opens something on tap and holds no buttons of its own is announced as a button, named by its
// own text. A card with its own buttons (accessible={false}) and a card with no tap action get no role.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import { CourseCard } from '@/components/CourseCard';
import { DisciplineCard } from '@/components/Disciplines';
import { HomeworkCard } from '@/components/HomeworkCard';
import { Card } from '@/components/ui';

import { courseA, fakeStore, hw } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

type TextNode = string | { children?: TextNode[] | null };
const textOf = (n: TextNode): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''));

beforeEach(() => jest.clearAllMocks());

describe('ARU-205 · Card', () => {
  it('AC A: a tappable grouped card is a button named by its text, with no label of its own', async () => {
    const onPress = jest.fn();
    await render(
      <Card onPress={onPress} testID="c">
        <Text>Algebra</Text>
        <Text>Owner: Max</Text>
      </Card>,
    );
    const card = screen.getByTestId('c');
    expect(card.props.role ?? card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBeUndefined();
    expect(card.props['aria-label']).toBeUndefined();
    expect(card.props.tabIndex).not.toBe(-1);
    expect(card).toHaveTextContent('AlgebraOwner: Max');
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('AC B: a card that holds its own buttons (accessible={false}) has no role and is no stop', async () => {
    const onPress = jest.fn();
    await render(
      <Card onPress={onPress} accessible={false} testID="c">
        <Text>Body</Text>
      </Card>,
    );
    const card = screen.getByTestId('c');
    expect(card.props.role).toBeUndefined();
    expect(card.props.accessibilityRole).toBeUndefined();
    expect(card.props.tabIndex).toBe(-1);
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('AC C: a card with no tap action is a plain view with no role', async () => {
    await render(
      <Card testID="c">
        <Text>Body</Text>
      </Card>,
    );
    const card = screen.getByTestId('c');
    expect(card.props.role).toBeUndefined();
    expect(card.props.accessibilityRole).toBeUndefined();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ARU-205 · course card', () => {
  it.each(['N', 'S1'] as const)('%s: a card whose description fits is one button that opens the course', async (who) => {
    setStore(fakeStore(who));
    await render(<CourseCard course={{ ...courseA, description: 'Short.' }} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(new RegExp(courseA.title));
    expect(buttons[0]).toHaveTextContent(/Short\./);
    await fireEvent.press(buttons[0]);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/courses/[id]' }));
  });
});

describe('ARU-205 · homework and discipline cards', () => {
  it.each(['T', 'M', 'S1'] as const)('%s: a homework card is one button that opens the homework', async (who) => {
    setStore(fakeStore(who));
    await render(<HomeworkCard item={hw({ id: 'H1', courseId: 'A' })} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/Homework H1/);
    expect(buttons[0]).toHaveTextContent(/Algebra/);
    await fireEvent.press(buttons[0]);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/homework/[id]', params: { id: 'H1' } });
  });

  it('a discipline card is one button; the double-tap guard still opens one page', async () => {
    setStore(fakeStore('S1'));
    await render(
      <DisciplineCard discipline={{ id: 'D1', name: 'Maths', hidden: false, createdById: 'T', createdAt: '2026-10-01T10:00:00.000Z' }} />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/Maths/);
    await fireEvent.press(buttons[0]);
    await fireEvent.press(buttons[0]);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/disciplines/[id]', params: { id: 'D1' } });
  });
});

describe('ARU-205 · Knowledge base', () => {
  it('a PDF card is a button named by its text that opens the file', async () => {
    setStore(
      fakeStore('S1', {
        materialFiles: [
          {
            id: 'F1',
            authorId: 'T',
            name: 'Book one',
            description: 'First chapter',
            storagePath: 'F1.pdf',
            sizeBytes: 2048,
            createdAt: '2026-10-20T10:00:00.000Z',
            updatedAt: '2026-10-20T10:00:00.000Z',
          },
        ],
      }),
    );
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
    const card = screen.getAllByRole('button').find((b) => /Book one/.test(textOf(b)));
    expect(card).toBeDefined();
    expect(card).toHaveTextContent(/First chapter/);
    expect(card!.props.accessibilityLabel).toBeUndefined();
    await fireEvent.press(card!);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/files/[id]', params: { id: 'F1' } });
  });

  it('a Blog post card keeps no role; only its inner buttons are buttons', async () => {
    setStore(
      fakeStore('S1', {
        materials: [{ id: 'P1', teacherId: 'T', title: 'Week one notes', body: 'Body.', createdAt: '2026-10-20T10:00:00.000Z' }],
      }),
    );
    await render(<MaterialsScreen />);
    const title = screen.getByRole('button', { name: 'Week one notes' });
    let node = title.parent;
    while (node) {
      expect(node.props.role === 'button' || node.props.accessibilityRole === 'button').toBe(false);
      node = node.parent;
    }
  });
});
