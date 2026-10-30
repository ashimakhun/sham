// ARU-29: filter the Materials list by author with a chip row (All + one chip per author). App-only, no data change.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import MaterialsScreen from '@/app/(tabs)/materials';
import type { Material, User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const mat = (id: string, teacherId: string, createdAt: string): Material => ({
  id,
  teacherId,
  title: `Material ${id}`,
  body: 'Body',
  createdAt,
});
const t1 = mat('t1', 'T', '2026-10-20T10:00:00.000Z');
const t2 = mat('t2', 'T', '2026-10-22T10:00:00.000Z');
const m1 = mat('m1', 'M', '2026-10-21T10:00:00.000Z');
const s3 = mat('s3', 'S3', '2026-10-19T10:00:00.000Z'); // "Abby Student": sorts first
const all = [t1, m1, t2, s3];

const chips = () =>
  screen
    .getAllByRole('button')
    .filter((b) => b.props.accessibilityState && 'selected' in b.props.accessibilityState)
    .map((b) => ({ label: b.props.accessibilityLabel as string, selected: !!b.props.accessibilityState.selected }));
const selectedChip = () =>
  chips()
    .filter((c) => c.selected)
    .map((c) => c.label);
const titles = () => screen.queryAllByText(/^Material /).map((n) => n.props.children);
const chip = (name: string) => screen.getByRole('button', { name });

beforeEach(() => jest.clearAllMocks());

describe('AC1/AC2: chip row', () => {
  it('shows All first, then authors by name (case-insensitive); All selected; full list newest first', async () => {
    const lower: User = { id: 'L', name: 'aaron lower', role: 'mentor' };
    const store = fakeStore('S1', { materials: [...all, mat('l1', 'L', '2026-10-18T10:00:00.000Z')] });
    setStore({
      ...store,
      users: [...store.users, lower],
      getUser: (id) => [...Object.values(users), lower].find((u) => u.id === id),
    });
    await render(<MaterialsScreen />);
    expect(chips().map((c) => c.label)).toEqual(['All', 'aaron lower', 'Abby Student', 'Mentor Max', 'Teacher Tess']);
    expect(selectedChip()).toEqual(['All']);
    expect(titles()).toEqual(['Material t2', 'Material m1', 'Material t1', 'Material s3', 'Material l1']);
  });

  it('AC9: no materials → no chip row, empty state unchanged', async () => {
    setStore(fakeStore('S1'));
    await render(<MaterialsScreen />);
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
    expect(screen.getByText('No materials yet')).toBeTruthy();
  });

  it('unknown author shows as "Unknown" and still filters', async () => {
    setStore(fakeStore('S1', { materials: [t1, mat('x1', 'GONE', '2026-10-25T10:00:00.000Z')] }));
    await render(<MaterialsScreen />);
    await fireEvent.press(chip('Unknown'));
    expect(titles()).toEqual(['Material x1']);
  });

  it('two authors with the same name get two chips', async () => {
    const twin: User = { id: 'M9', name: 'Mentor Max', role: 'mentor' };
    const store = fakeStore('S1', { materials: [m1, mat('x9', 'M9', '2026-10-25T10:00:00.000Z')] });
    setStore({ ...store, getUser: (id) => [...Object.values(users), twin].find((u) => u.id === id) });
    await render(<MaterialsScreen />);
    expect(chips().filter((c) => c.label === 'Mentor Max')).toHaveLength(2);
  });
});

describe('AC3-AC5: selecting', () => {
  it('an author chip shows only their materials, newest first; All restores; tapping again changes nothing', async () => {
    setStore(fakeStore('M', { materials: all }));
    await render(<MaterialsScreen />);
    await fireEvent.press(chip('Teacher Tess'));
    expect(selectedChip()).toEqual(['Teacher Tess']);
    expect(titles()).toEqual(['Material t2', 'Material t1']);
    await fireEvent.press(chip('Teacher Tess'));
    expect(selectedChip()).toEqual(['Teacher Tess']);
    expect(titles()).toEqual(['Material t2', 'Material t1']);
    await fireEvent.press(chip('All'));
    expect(selectedChip()).toEqual(['All']);
    expect(titles()).toHaveLength(4);
  });

  it('AC12: chips are buttons labelled with their text and expose the selected state', async () => {
    setStore(fakeStore('S1', { materials: all }));
    await render(<MaterialsScreen />);
    expect(chip('Mentor Max').props.accessibilityState).toMatchObject({ selected: false });
    expect(chip('All').props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('AC6-AC8/AC10/AC11: live changes keep the selection', () => {
  it('a refresh or live update keeps the author and shows their current materials', async () => {
    setStore(fakeStore('S1', { materials: all }));
    const { rerender } = await render(<MaterialsScreen />);
    await fireEvent.press(chip('Teacher Tess'));
    setStore(
      fakeStore('S1', {
        materials: [...all, mat('t3', 'T', '2026-10-28T10:00:00.000Z'), mat('n1', 'N', '2026-10-29T10:00:00.000Z')],
      }),
    );
    await rerender(<MaterialsScreen />);
    expect(selectedChip()).toEqual(['Teacher Tess']);
    expect(titles()).toEqual(['Material t3', 'Material t2', 'Material t1']);
    // AC 8: the new author's chip appears in alphabetical order.
    expect(chips().map((c) => c.label)).toEqual(['All', 'Abby Student', 'Mentor Max', 'Mentor Nina', 'Teacher Tess']);
  });

  it("AC7: when the author's last material is gone, their chip disappears and All is selected, and stays so", async () => {
    setStore(fakeStore('M', { materials: all }));
    const { rerender } = await render(<MaterialsScreen />);
    await fireEvent.press(chip('Mentor Max'));
    setStore(fakeStore('M', { materials: [t1, t2, s3] }));
    await rerender(<MaterialsScreen />);
    expect(screen.queryByRole('button', { name: 'Mentor Max' })).toBeNull();
    expect(selectedChip()).toEqual(['All']);
    expect(titles()).toHaveLength(3);
    // Max shares again later: the filter stays on All.
    setStore(fakeStore('M', { materials: all }));
    await rerender(<MaterialsScreen />);
    expect(selectedChip()).toEqual(['All']);
  });

  it('AC10: the Share button stays above the chip row; opening a material keeps the selection (AC11)', async () => {
    setStore(fakeStore('T', { materials: all }));
    await render(<MaterialsScreen />);
    const buttons = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel ?? 'share');
    expect(buttons.indexOf('share')).toBeLessThan(buttons.indexOf('All'));
    await fireEvent.press(chip('Mentor Max'));
    await fireEvent.press(screen.getByText('Material m1'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/materials/[id]', params: { id: 'm1' } });
    expect(selectedChip()).toEqual(['Mentor Max']);
  });
});
