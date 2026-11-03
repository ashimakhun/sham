// ARU-52: likes on Blog posts. The post screen has Like / Liked, the count and "Liked by" (newest first); Blog cards
// show "♥ N" when someone liked the post. Database rules: supabase/tests/aru52_material_likes.test.sql.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import type { Material, MaterialLike } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const A: Material = { id: 'A', teacherId: 'T', title: 'Post A', body: 'x', createdAt: '2026-10-20T10:00:00.000Z' };
const B: Material = { id: 'B', teacherId: 'M', title: 'Post B', body: 'y', createdAt: '2026-10-21T10:00:00.000Z' };
const like = (materialId: string, userId: string, minute: number): MaterialLike => ({
  materialId,
  userId,
  createdAt: `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`,
});
const store = (who: keyof typeof users, materialLikes: MaterialLike[] = [], over: Parameters<typeof fakeStore>[1] = {}) =>
  fakeStore(who, { materials: [A, B], materialLikes, ...over });
const likedBy = () =>
  within(screen.getByTestId('liked-by'))
    .queryAllByText(/^(Teacher|Mentor|Student|Abby)/)
    .map((n) => n.props.children);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('post screen', () => {
  it.each(['S1', 'M', 'T'] as const)('AC1 %s likes a post they have not liked', async (who) => {
    const s = store(who);
    setStore(s);
    await render(<MaterialDetailScreen />);
    expect(screen.getByText('No likes yet')).toBeTruthy();
    expect(screen.getByText('0 likes')).toBeTruthy();
    expect(screen.queryByTestId('liked-by')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(s.likeMaterial).toHaveBeenCalledWith('A');
    expect(s.unlikeMaterial).not.toHaveBeenCalled();
  });

  it('AC2 a liked post shows Liked, and tapping it unlikes', async () => {
    const s = store('S1', [like('A', 'S1', 1)]);
    setStore(s);
    await render(<MaterialDetailScreen />);
    expect(screen.getByText('♥ Liked')).toBeTruthy();
    expect(screen.getByText('1 like')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Unlike, liked' }));
    expect(s.unlikeMaterial).toHaveBeenCalledWith('A');
    expect(s.likeMaterial).not.toHaveBeenCalled();
  });

  it('AC3 shows the count and the names, newest like first; only this post\'s likes', async () => {
    setStore(store('S2', [like('A', 'S1', 1), like('A', 'T', 3), like('A', 'M', 2), like('B', 'N', 4)]));
    await render(<MaterialDetailScreen />);
    expect(screen.getByText('3 likes')).toBeTruthy();
    expect(likedBy()).toEqual(['Teacher Tess', 'Mentor Max', 'Student Sam']);
    expect(screen.queryByText('No likes yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Like' })).toBeTruthy();
  });

  it('AC5 the author likes their own post', async () => {
    const s = store('T');
    setStore(s);
    await render(<MaterialDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(s.likeMaterial).toHaveBeenCalledWith('A');
  });

  it('AC6 a like arriving live updates the open screen', async () => {
    setStore(store('S2'));
    const view = await render(<MaterialDetailScreen />);
    expect(screen.getByText('No likes yet')).toBeTruthy();
    setStore(store('S2', [like('A', 'S1', 1)]));
    await view.rerender(<MaterialDetailScreen />);
    expect(screen.getByText('1 like')).toBeTruthy();
    expect(likedBy()).toEqual(['Student Sam']);
  });

  it('AC8 likes of accounts that are not loaded (waiting or declined) are not shown or counted', async () => {
    setStore(store('S2', [like('A', 'S1', 1), like('A', 'P-pending', 2)]));
    await render(<MaterialDetailScreen />);
    expect(screen.getByText('1 like')).toBeTruthy();
    expect(likedBy()).toEqual(['Student Sam']);
  });

  it('AC10 a failed like shows the error and keeps the previous state', async () => {
    setStore(store('S1', [], { likeMaterial: jest.fn().mockRejectedValue(new Error('Network request failed')) }));
    await render(<MaterialDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Like' })).toBeTruthy();
    expect(screen.getByText('No likes yet')).toBeTruthy();
  });

  it('AC10 the button is disabled while the like is saving, so a double tap saves once', async () => {
    let finish: () => void = () => {};
    const s = store('S1', [], { likeMaterial: jest.fn(() => new Promise<void>((r) => (finish = r))) });
    setStore(s);
    await render(<MaterialDetailScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Like' })).toBeDisabled());
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(s.likeMaterial).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Like' })).toBeEnabled());
  });
});

describe('Blog list (AC 4, 9)', () => {
  it('cards show "♥ N" when liked and nothing when not', async () => {
    setStore(store('S1', [like('A', 'S1', 1), like('A', 'T', 2), like('A', 'P-pending', 3)]));
    await render(<MaterialsScreen />);
    expect(screen.getByLabelText('2 likes')).toBeTruthy();
    expect(screen.getByText(/♥ 2/)).toBeTruthy();
    expect(screen.queryAllByText(/♥/)).toHaveLength(1);
  });

  it('tapping a card still opens the post', async () => {
    const { router } = require('expo-router');
    setStore(store('S1', [like('A', 'S1', 1)]));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByText('Post A'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/[id]', params: { id: 'A' } });
  });

  it('likes of a deleted post are ignored', async () => {
    setStore(store('S1', [like('gone', 'S1', 1)]));
    await render(<MaterialsScreen />);
    expect(screen.queryAllByText(/♥/)).toHaveLength(0);
  });
});
