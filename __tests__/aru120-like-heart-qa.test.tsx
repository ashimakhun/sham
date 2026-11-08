// QA ARU-120: gaps in aru120-like-heart.test.tsx: every role likes and unlikes from the card and the post page,
// including the author on their own post; a tap on the card's author line (not the heart) still opens the post; on
// the post page a post liked only by others shows the hollow grey heart with a grey count, a failed unlike keeps the
// filled heart and shows the error in the first card, and the busy heart ignores a second tap; liker rows have no
// role and their heart is hidden from screen readers; Open link and Delete stay; a long author name keeps the heart.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import { colors } from '@/lib/theme';
import type { Material, MaterialLike } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const A: Material = {
  id: 'A',
  teacherId: 'T',
  title: 'Post A',
  body: 'x',
  link: 'https://x.y',
  createdAt: '2026-10-20T10:00:00.000Z',
};
const B: Material = { id: 'B', teacherId: 'M', title: 'Post B', body: 'y', createdAt: '2026-10-21T10:00:00.000Z' };
const like = (materialId: string, userId: string, minute = 0): MaterialLike => ({
  materialId,
  userId,
  createdAt: `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`,
});
const store = (who: keyof typeof users, materialLikes: MaterialLike[] = [], over: Parameters<typeof fakeStore>[1] = {}) =>
  fakeStore(who, { materials: [A, B], materialLikes, ...over });
const hidden = { includeHiddenElements: true };
const icon = (heart: ReturnType<typeof screen.getByTestId>, name: string) => within(heart).getByTestId(`icon-${name}`).props;

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('access: every role likes and unlikes', () => {
  it.each(['S1', 'M', 'T'] as const)('%s likes B and unlikes A from the Blog card', async (who) => {
    const s = store(who, [like('A', who)]);
    setStore(s);
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByTestId('like-B'));
    await fireEvent.press(screen.getByTestId('like-A'));
    expect(s.likeMaterial).toHaveBeenCalledWith('B');
    expect(s.unlikeMaterial).toHaveBeenCalledWith('A');
  });

  it.each(['S1', 'M', 'T'] as const)('%s likes from the post page', async (who) => {
    const s = store(who);
    setStore(s);
    await render(<MaterialDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(s.likeMaterial).toHaveBeenCalledWith('A');
  });

  it('the author likes their own post (T on A), and it counts', async () => {
    setStore(store('T', [like('A', 'T')]));
    await render(<MaterialDetailScreen />);
    const heart = screen.getByTestId('like-A');
    expect(heart).toHaveAccessibleName('Unlike, 1 like');
    expect(within(screen.getByTestId('liked-by')).getByText(users.T.name)).toBeTruthy();
  });
});

describe('Blog card', () => {
  it('AC 4: tapping the author · date line (not the heart) still opens the post and likes nothing', async () => {
    const { router } = require('expo-router');
    const s = store('S1');
    setStore(s);
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByText(/^Mentor Max · /));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/[id]', params: { id: 'B' } });
    expect(s.likeMaterial).not.toHaveBeenCalled();
  });

  it('edge case: a very long author name keeps the heart and count on the card', async () => {
    const long = { ...users.M, name: 'Mentor '.repeat(30).trim() };
    setStore({ ...store('S1', [like('B', 'S1')]), getUser: (id: string | undefined) => (id === 'M' ? long : id ? (users as never)[id] : undefined) });
    await render(<MaterialsScreen />);
    const b = screen.getByTestId('like-B');
    expect(b).toHaveAccessibleName('Unlike, 1 like');
    expect(within(b).getByText('1')).toBeTruthy();
  });
});

describe('post page', () => {
  it('AC 2 / AC 3: liked only by others: hollow grey heart with a grey count', async () => {
    setStore(store('S1', [like('A', 'M'), like('A', 'T', 1)]));
    await render(<MaterialDetailScreen />);
    const heart = screen.getByTestId('like-A');
    expect(heart).toHaveAccessibleName('Like, 2 likes');
    expect(heart).not.toBeSelected();
    expect(icon(heart, 'heart-outline')).toEqual(expect.objectContaining({ color: colors.muted }));
    expect(within(heart).getByText('2')).toHaveStyle({ color: colors.muted });
  });

  it('AC 6 / AC 7: a failed unlike keeps the filled heart and count, and the error shows in the first card', async () => {
    setStore(
      store('S1', [like('A', 'S1')], {
        unlikeMaterial: jest.fn().mockRejectedValue(new Error('Network request failed')),
      }),
    );
    await render(<MaterialDetailScreen />);
    await fireEvent.press(screen.getByTestId('like-A'));
    expect(await screen.findAllByText('Network request failed')).toHaveLength(1);
    const heart = screen.getByTestId('like-A');
    expect(heart).toHaveAccessibleName('Unlike, 1 like');
    expect(icon(heart, 'heart')).toEqual(expect.objectContaining({ color: colors.primary }));
  });

  it('AC 6 / AC 7: while saving on the post page the heart is dimmed and a second tap does nothing', async () => {
    let finish: () => void = () => {};
    const s = store('S1', [], { likeMaterial: jest.fn(() => new Promise<void>((r) => (finish = r))) });
    setStore(s);
    await render(<MaterialDetailScreen />);
    fireEvent.press(screen.getByTestId('like-A'));
    await waitFor(() => expect(screen.getByTestId('like-A')).toBeDisabled());
    expect(screen.getByTestId('like-A')).toHaveStyle({ opacity: 0.4 });
    await fireEvent.press(screen.getByTestId('like-A'));
    expect(s.likeMaterial).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByTestId('like-A')).toBeEnabled());
  });

  it('AC 9 / AC 11: liker rows are not buttons, and their heart is hidden from screen readers', async () => {
    setStore(store('S1', [like('A', 'M'), like('A', 'T', 1)]));
    await render(<MaterialDetailScreen />);
    const card = screen.getByTestId('liked-by');
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
    expect(within(card).getByLabelText(users.M.name)).toBeTruthy();
    expect(within(card).getByLabelText(users.T.name)).toBeTruthy();
    // The decorative hearts are only found when hidden elements are included.
    expect(within(card).queryAllByTestId('icon-heart')).toHaveLength(0);
    expect(within(card).getAllByTestId('icon-heart', hidden)).toHaveLength(2);
  });

  it('regression: Open link stays, and the author still sees Delete', async () => {
    setStore(store('T', [like('A', 'S1')]));
    await render(<MaterialDetailScreen />);
    expect(screen.getByRole('button', { name: 'Open link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Delete/ })).toBeTruthy();
  });
});
