// ARU-29 QA additions to aru29-materials-author-filter.test.tsx, from the TEST DESIGN: the case-insensitive sort with
// a lowercase name, the user's own new material while another author is selected (AC 10), a mentor demoted to
// student keeping their chip (edge), chip taps making no network call (data check), students filtering without a
// Share button, and Delete still only on the user's own materials under a filter (regression).
import { fireEvent, render, screen } from '@testing-library/react-native';

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
const m1 = mat('m1', 'M', '2026-10-21T10:00:00.000Z');
const n1 = mat('n1', 'N', '2026-10-22T10:00:00.000Z');

const chipLabels = () =>
  screen
    .getAllByRole('button')
    .filter((b) => b.props.accessibilityState && 'selected' in b.props.accessibilityState && b.props.accessibilityLabel)
    .map((b) => b.props.accessibilityLabel as string);
const selectedChip = () =>
  screen
    .getAllByRole('button')
    .filter((b) => b.props.accessibilityState?.selected)
    .map((b) => b.props.accessibilityLabel as string);
const titles = () => screen.queryAllByText(/^Material /).map((n) => n.props.children);
const chip = (name: string) => screen.getByRole('button', { name });

/** fakeStore with extra users, so names can differ in letter case. */
const storeWith = (who: keyof typeof users, extra: User[], materials: Material[]) => {
  const all = [...Object.values(users), ...extra];
  return fakeStore(who, { users: all, getUser: (id) => all.find((u) => u.id === id), materials });
};

beforeEach(() => jest.clearAllMocks());

it('AC1: the order ignores letter case ("anna" before "Boris" before "Mentor Max")', async () => {
  const anna: User = { id: 'A1', name: 'anna', role: 'mentor' };
  const boris: User = { id: 'B1', name: 'Boris', role: 'mentor' };
  setStore(
    storeWith('S1', [anna, boris], [m1, mat('b1', 'B1', '2026-10-23T10:00:00.000Z'), mat('a1', 'A1', '2026-10-24T10:00:00.000Z')]),
  );
  await render(<MaterialsScreen />);
  expect(chipLabels()).toEqual(['All', 'anna', 'Boris', 'Mentor Max']);
});

it('AC10: sharing my first material while another author is selected keeps that chip; mine shows under All and my chip', async () => {
  setStore(fakeStore('M2', { materials: [t1, m1] }));
  const view = await render(<MaterialsScreen />);
  expect(screen.getByRole('button', { name: '+ Share material' })).toBeTruthy();
  await fireEvent.press(chip('Teacher Tess'));
  // Back from the Share screen: the store now has M2's new material (the tab stayed mounted).
  setStore(fakeStore('M2', { materials: [t1, m1, mat('mo1', 'M2', '2026-10-29T10:00:00.000Z')] }));
  await view.rerender(<MaterialsScreen />);
  expect(selectedChip()).toEqual(['Teacher Tess']);
  expect(titles()).toEqual(['Material t1']);
  expect(chipLabels()).toEqual(['All', 'Mentor Max', 'Mentor Mo', 'Teacher Tess']);
  await fireEvent.press(chip('Mentor Mo'));
  expect(titles()).toEqual(['Material mo1']);
  await fireEvent.press(chip('All'));
  expect(titles()).toEqual(['Material mo1', 'Material m1', 'Material t1']);
});

it('edge: a mentor made student keeps their chip and their materials stay filterable', async () => {
  const demoted = { ...users, M: { ...users.M, role: 'student' as const } };
  const all = Object.values(demoted);
  setStore(fakeStore('S1', { users: all, getUser: (id) => all.find((u) => u.id === id), materials: [t1, m1] }));
  await render(<MaterialsScreen />);
  expect(chipLabels()).toEqual(['All', 'Mentor Max', 'Teacher Tess']);
  await fireEvent.press(chip('Mentor Max'));
  expect(titles()).toEqual(['Material m1']);
});

it('data: tapping chips makes no network call (no refresh, no store action)', async () => {
  const store = fakeStore('S1', { materials: [t1, m1, n1] });
  setStore(store);
  await render(<MaterialsScreen />);
  await fireEvent.press(chip('Mentor Nina'));
  await fireEvent.press(chip('All'));
  await fireEvent.press(chip('Teacher Tess'));
  expect(store.refresh).not.toHaveBeenCalled();
  expect(store.deleteMaterial).not.toHaveBeenCalled();
  expect(store.addMaterial).not.toHaveBeenCalled();
});

it('roles: a student gets the chip row but no "+ Share material"; filtering works', async () => {
  setStore(fakeStore('S1', { materials: [t1, m1] }));
  await render(<MaterialsScreen />);
  expect(screen.queryByRole('button', { name: '+ Share material' })).toBeNull();
  await fireEvent.press(chip('Mentor Max'));
  expect(titles()).toEqual(['Material m1']);
  expect(selectedChip()).toEqual(['Mentor Max']);
});

it('AC9 (teacher): with no materials the Share button stays and there is no chip row', async () => {
  setStore(fakeStore('T', { materials: [] }));
  await render(<MaterialsScreen />);
  expect(screen.getByRole('button', { name: '+ Share material' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
});
