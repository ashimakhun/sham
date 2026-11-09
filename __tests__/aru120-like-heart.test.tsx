// ARU-120: like a Blog post with a heart on its card; on the post page the heart sits by the author, and the likers
// card lists names with a decorative heart (no "Liked by" heading, hidden at 0 likes).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import { likeTexts } from '@/components/LikeHeart';
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
// jest.setup.js mocks Ionicons as a Text with testID icon-<name>.
const icon = (heart: ReturnType<typeof screen.getByTestId>, name: string) => within(heart).getByTestId(`icon-${name}`).props;
const hidden = { includeHiddenElements: true };

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('labels (AC 11)', () => {
  it('"Like" at 0, "Like, 1 like", "Unlike, 2 likes"', () => {
    expect(likeTexts.label(false, 0)).toBe('Like');
    expect(likeTexts.label(false, 1)).toBe('Like, 1 like');
    expect(likeTexts.label(true, 2)).toBe('Unlike, 2 likes');
  });
});

describe('Blog card', () => {
  it('AC 1–3: author · date · link on the left; heart and count on the right; no "♥ N" text', async () => {
    setStore(store('S1', [like('A', 'S1'), like('A', 'T', 1), like('B', 'M')]));
    await render(<MaterialsScreen />);
    expect(screen.getByText(/^Teacher Tess · .* · 🔗 link$/)).toBeTruthy();
    expect(screen.queryAllByText(/♥/)).toHaveLength(0);
    const a = screen.getByTestId('like-A');
    expect(a).toHaveAccessibleName('Unlike, 2 likes');
    expect(a).toBeSelected();
    expect(icon(a, 'heart')).toEqual(expect.objectContaining({ color: colors.primary }));
    expect(within(a).getByText('2')).toHaveStyle({ color: colors.primary });
    const b = screen.getByTestId('like-B');
    expect(b).toHaveAccessibleName('Like, 1 like');
    expect(icon(b, 'heart-outline')).toEqual(expect.objectContaining({ color: colors.muted }));
    expect(b).not.toBeSelected();
    expect(within(b).getByText('1')).toHaveStyle({ color: colors.muted });
  });

  it('AC 3: 0 likes shows the hollow heart with no number; unloaded likers are not counted', async () => {
    setStore(store('S1', [like('B', 'P-pending')]));
    await render(<MaterialsScreen />);
    const b = screen.getByTestId('like-B');
    expect(b).toHaveAccessibleName('Like');
    expect(within(b).queryByText(/\d/)).toBeNull();
  });

  it('AC 4: tapping the heart likes or unlikes and does not open the post; the title still opens it', async () => {
    const { router } = require('expo-router');
    const s = store('S1', [like('A', 'S1')]);
    setStore(s);
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByTestId('like-B'));
    expect(s.likeMaterial).toHaveBeenCalledWith('B');
    await fireEvent.press(screen.getByTestId('like-A'));
    expect(s.unlikeMaterial).toHaveBeenCalledWith('A');
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Post A'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/[id]', params: { id: 'A' } });
  });

  it('AC 5: a plain icon with a touch area of at least 44×44', async () => {
    setStore(store('S1'));
    await render(<MaterialsScreen />);
    const heart = screen.getByTestId('like-A');
    expect(heart.props.hitSlop).toBe(12); // 22pt icon (min 24) + 2×12 slop ≥ 44 each way
    expect(heart).not.toHaveStyle({ borderWidth: expect.anything() });
    expect(heart).not.toHaveStyle({ backgroundColor: expect.anything() });
  });

  it('AC 6: while saving the heart is dimmed, a second tap does nothing and does not open the post', async () => {
    const { router } = require('expo-router');
    let finish: () => void = () => {};
    const s = store('S1', [], { likeMaterial: jest.fn(() => new Promise<void>((r) => (finish = r))) });
    setStore(s);
    await render(<MaterialsScreen />);
    fireEvent.press(screen.getByTestId('like-A'));
    await waitFor(() => expect(screen.getByTestId('like-A')).toBeDisabled());
    expect(screen.getByTestId('like-A')).toHaveStyle({ opacity: 0.4 });
    await fireEvent.press(screen.getByTestId('like-A'));
    expect(s.likeMaterial).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(screen.getByTestId('like-A')).toBeEnabled());
  });

  it('AC 6: a failed like shows the error on that card only and keeps the heart', async () => {
    setStore(store('S1', [], { likeMaterial: jest.fn().mockRejectedValue(new Error('Network request failed')) }));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByTestId('like-A'));
    expect(await screen.findAllByText('Network request failed')).toHaveLength(1);
    expect(screen.getByTestId('like-A')).toHaveAccessibleName('Like');
  });

  it('AC 13: the Knowledge base tab has no hearts', async () => {
    setStore(store('S1', [like('A', 'S1')]));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
    expect(screen.queryByTestId('like-A')).toBeNull();
  });
});

describe('post page', () => {
  it('AC 7: no Like button or "N likes" text; the heart is in the author row and likes', async () => {
    const s = store('S2', [like('A', 'S1')]);
    setStore(s);
    await render(<MaterialDetailScreen />);
    expect(screen.queryByText(/Like|Liked|likes?$/)).toBeNull();
    const heart = screen.getByTestId('like-A');
    expect(heart).toHaveAccessibleName('Like, 1 like');
    await fireEvent.press(heart);
    expect(s.likeMaterial).toHaveBeenCalledWith('A');
  });

  it('AC 8, 9, 11: likers newest first, each with a decorative heart, no heading, rows read as the name', async () => {
    setStore(store('S2', [like('A', 'S1', 1), like('A', 'T', 3), like('A', 'M', 2)]));
    await render(<MaterialDetailScreen />);
    const card = screen.getByTestId('liked-by');
    expect(within(card).queryByText('Liked by')).toBeNull();
    expect(within(card).getAllByLabelText(/./).map((n) => n.props.accessibilityLabel)).toEqual([
      'Teacher Tess',
      'Mentor Max',
      'Student Sam',
    ]);
    expect(within(card).queryAllByTestId('icon-heart')).toHaveLength(0); // not read by screen readers
    const hearts = within(card).getAllByTestId('icon-heart', hidden);
    expect(hearts).toHaveLength(3);
    expect(hearts[0].props.color).toBe(colors.primary);
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
  });

  it('AC 10: at 0 likes there is no likers card and no "No likes yet"; a like error still shows', async () => {
    setStore(store('S1', [], { likeMaterial: jest.fn().mockRejectedValue(new Error('Network request failed')) }));
    await render(<MaterialDetailScreen />);
    expect(screen.queryByTestId('liked-by')).toBeNull();
    expect(screen.queryByText('No likes yet')).toBeNull();
    await fireEvent.press(screen.getByTestId('like-A'));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
  });

  it('a like from another device updates the heart, count and list live', async () => {
    setStore(store('S1'));
    const view = await render(<MaterialDetailScreen />);
    setStore(store('S1', [like('A', 'S1'), like('A', 'M', 1)]));
    await view.rerender(<MaterialDetailScreen />);
    expect(screen.getByTestId('like-A')).toHaveAccessibleName('Unlike, 2 likes');
    expect(within(screen.getByTestId('liked-by')).getByText('Mentor Max')).toBeTruthy();
  });
});
