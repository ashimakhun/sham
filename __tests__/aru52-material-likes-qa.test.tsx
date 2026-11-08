// QA ARU-52: screen-side gaps: accessibility (button label and state, the card's spoken count, singular "1 like"),
// a like screen that follows the like being removed elsewhere, a post deleted while open, and the Blog list's author
// filter and Knowledge base tab staying as they were. ARU-120 replaced the Like button, the "N likes" text and the
// card's " · ♥ N" with a heart labelled "Like" / "Like, N likes" / "Unlike, N likes"; these checks follow it.
import { fireEvent, render, screen } from '@testing-library/react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import type { Material, MaterialLike } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const A: Material = { id: 'A', teacherId: 'T', title: 'Post A', body: 'x', createdAt: '2026-10-20T10:00:00.000Z' };
const B: Material = { id: 'B', teacherId: 'M', title: 'Post B', body: 'y', createdAt: '2026-10-21T10:00:00.000Z' };
const like = (materialId: string, userId: string, minute = 0): MaterialLike => ({
  materialId,
  userId,
  createdAt: `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`,
});
const store = (who: keyof typeof users, materialLikes: MaterialLike[] = [], over: Parameters<typeof fakeStore>[1] = {}) =>
  fakeStore(who, { materials: [A, B], materialLikes, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('accessibility (edge case iOS/Android)', () => {
  it('the heart is "Like" (not selected), then "Unlike, 1 like" (selected) (ARU-120)', async () => {
    setStore(store('S1'));
    const view = await render(<MaterialDetailScreen />);
    const off = screen.getByRole('button', { name: 'Like' });
    expect(off.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    setStore(store('S1', [like('A', 'S1')]));
    await view.rerender(<MaterialDetailScreen />);
    const on = screen.getByRole('button', { name: 'Unlike, 1 like' });
    expect(on.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  it('one like reads "1 like" on the post and on the card', async () => {
    setStore(store('S2', [like('A', 'S1')]));
    const view = await render(<MaterialDetailScreen />);
    expect(screen.getByRole('button', { name: 'Like, 1 like' })).toBeTruthy();
    await view.unmount();
    await render(<MaterialsScreen />);
    expect(screen.getByRole('button', { name: 'Like, 1 like' })).toBeTruthy();
    expect(screen.queryByText(/♥/)).toBeNull();
  });

  it('the card count is spoken in the heart\'s label; 0 likes has no number', async () => {
    setStore(store('S2', [like('B', 'S1'), like('B', 'T', 1), like('B', 'M', 2)]));
    await render(<MaterialsScreen />);
    expect(screen.getByRole('button', { name: 'Like, 3 likes' })).toBeTruthy();
    expect(screen.getByTestId('like-A')).toHaveAccessibleName('Like');
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('AC 6 / AC 10: changes made elsewhere', () => {
  it('my like removed on another device: the screen shows Like again with the new count, no error', async () => {
    setStore(store('S1', [like('A', 'S1'), like('A', 'M', 1)]));
    const view = await render(<MaterialDetailScreen />);
    expect(screen.getByRole('button', { name: 'Unlike, 2 likes' })).toBeTruthy();
    setStore(store('S1', [like('A', 'M', 1)]));
    await view.rerender(<MaterialDetailScreen />);
    expect(screen.getByRole('button', { name: 'Like, 1 like' })).toBeTruthy();
  });

  it('AC 9: the post deleted while open shows "Material not found"', async () => {
    setStore(store('S1', [like('A', 'S1')]));
    const view = await render(<MaterialDetailScreen />);
    setStore(store('S1', [], { materials: [B] }));
    await view.rerender(<MaterialDetailScreen />);
    expect(screen.getByText('Material not found')).toBeTruthy();
  });

  it('AC 10: an unlike that fails keeps Liked and shows the error', async () => {
    const s = store('S1', [like('A', 'S1')], { unlikeMaterial: jest.fn(async () => { throw new Error('Network request failed'); }) });
    setStore(s);
    await render(<MaterialDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Unlike, 1 like' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unlike, 1 like' })).toBeTruthy();
  });
});

describe('regression: Blog list', () => {
  it('the author filter keeps each card\'s count', async () => {
    setStore(store('S1', [like('A', 'S1'), like('B', 'T'), like('B', 'M', 1)]));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /^Filter by author/ })); // ARU-62: authors open from one Filter button
    await fireEvent.press(screen.getByRole('button', { name: /Mentor Max/ }));
    expect(screen.queryByText('Post A')).toBeNull();
    expect(screen.getByRole('button', { name: 'Like, 2 likes' })).toBeTruthy();
  });

  it('the Knowledge base tab shows no like counts', async () => {
    setStore(store('S1', [like('A', 'S1')]));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
    expect(screen.queryByText(/♥/)).toBeNull();
    expect(screen.queryByTestId(/^like-/)).toBeNull();
  });
});
