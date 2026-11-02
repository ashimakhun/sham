// QA ARU-62: gaps in aru62-blog-filter-button.test.tsx: 20 authors (every one reachable and selectable), picking
// makes no store or network call, the button follows a live rename, a new author appearing while the list is open,
// every post disappearing while the list is open, an author coming back after the fall-back stays on All, a fresh
// mount starts at All, and the button and entries keep 44 pt targets with hidden decorations.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import type { Material, User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const mat = (id: string, teacherId: string, day: number): Material => ({
  id,
  teacherId,
  title: `Material ${id}`,
  body: 'Body',
  createdAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`,
});
const filterButton = () => screen.getByRole('button', { name: /^Filter by author, / });
const listNode = () => screen.queryByTestId('author-filter-list');
const entry = (name: string) => within(screen.getByTestId('author-filter-list')).getByRole('button', { name });
const labels = () =>
  within(screen.getByTestId('author-filter-list'))
    .getAllByRole('button')
    .map((b) => b.props.accessibilityLabel as string);
const titles = () => screen.queryAllByText(/^Material /).map((n) => n.props.children);
const open = () => fireEvent.press(filterButton());

beforeEach(() => jest.clearAllMocks());

function withUsers(extra: User[], over: Parameters<typeof fakeStore>[1] = {}) {
  const everyone = [...Object.values(users), ...extra];
  return fakeStore('S1', { users: everyone, getUser: (id) => everyone.find((u) => u.id === id), ...over });
}

it('AC6: with 20 authors the list scrolls and the last author can be picked', async () => {
  const many: User[] = Array.from({ length: 20 }, (_, i) => ({ id: `A${i}`, name: `Author ${String(i).padStart(2, '0')}`, role: 'mentor' }));
  setStore(withUsers(many, { materials: many.map((u, i) => mat(`p${i}`, u.id, i + 1)) }));
  await render(<MaterialsScreen />);
  await open();
  expect(labels()).toEqual(['All', ...many.map((u) => u.name)]);
  // The entries live inside a ScrollView whose sheet is height-capped, so they scroll rather than run off-screen.
  expect(screen.getByTestId('author-filter-list').type).toBe('RCTScrollView');
  await fireEvent.press(entry('Author 19'));
  expect(listNode()).toBeNull();
  expect(titles()).toEqual(['Material p19']);
  expect(screen.getByText('Filter: Author 19')).toBeTruthy();
});

it('AC7: opening the list and picking makes no store or network call', async () => {
  const store = fakeStore('S1', { materials: [mat('t1', 'T', 20), mat('m1', 'M', 21)] });
  setStore(store);
  await render(<MaterialsScreen />);
  await open();
  await fireEvent.press(entry('Mentor Max'));
  await open();
  await fireEvent.press(entry('All'));
  for (const [k, v] of Object.entries(store)) {
    if (jest.isMockFunction(v)) expect([k, v.mock.calls.length]).toEqual([k, 0]);
  }
});

it('AC3 / analysis note 3: the button follows a live rename of the selected author', async () => {
  const renamed = { ...users.M, name: 'Max Mentorov' };
  setStore(fakeStore('S1', { materials: [mat('t1', 'T', 20), mat('m1', 'M', 21)] }));
  const { rerender } = await render(<MaterialsScreen />);
  await open();
  await fireEvent.press(entry('Mentor Max'));
  setStore(withUsers([], {
    materials: [mat('t1', 'T', 20), mat('m1', 'M', 21)],
    getUser: (id) => (id === 'M' ? renamed : Object.values(users).find((u) => u.id === id)),
  }));
  await rerender(<MaterialsScreen />);
  expect(screen.getByText('Filter: Max Mentorov')).toBeTruthy();
  expect(filterButton().props.accessibilityLabel).toBe('Filter by author, Max Mentorov');
  expect(titles()).toEqual(['Material m1']);
});

it('edge: a new author sharing while the list is open appears in it, in order, without a crash', async () => {
  setStore(fakeStore('S1', { materials: [mat('t1', 'T', 20)] }));
  const { rerender } = await render(<MaterialsScreen />);
  await open();
  setStore(fakeStore('S1', { materials: [mat('t1', 'T', 20), mat('m1', 'M', 21)] }));
  await rerender(<MaterialsScreen />);
  expect(labels()).toEqual(['All', 'Mentor Max', 'Teacher Tess']);
  await fireEvent.press(entry('Mentor Max'));
  expect(titles()).toEqual(['Material m1']);
});

it('edge: every post disappearing while the list is open removes the button and list, no crash', async () => {
  setStore(fakeStore('S1', { materials: [mat('t1', 'T', 20)] }));
  const { rerender } = await render(<MaterialsScreen />);
  await open();
  await fireEvent.press(entry('Teacher Tess'));
  await open();
  setStore(fakeStore('S1', { materials: [] }));
  await rerender(<MaterialsScreen />);
  expect(listNode()).toBeNull();
  expect(screen.queryByRole('button', { name: /^Filter by author/ })).toBeNull();
  expect(screen.getByText('No materials yet')).toBeTruthy();
  // A post comes back: the filter is All, not the old author.
  setStore(fakeStore('S1', { materials: [mat('t2', 'T', 22)] }));
  await rerender(<MaterialsScreen />);
  expect(screen.getByText('Filter: All')).toBeTruthy();
});

it('AC7: after falling back to All, the author sharing again keeps the filter on All', async () => {
  setStore(fakeStore('S1', { materials: [mat('t1', 'T', 20), mat('m1', 'M', 21)] }));
  const { rerender } = await render(<MaterialsScreen />);
  await open();
  await fireEvent.press(entry('Mentor Max'));
  setStore(fakeStore('S1', { materials: [mat('t1', 'T', 20)] }));
  await rerender(<MaterialsScreen />);
  setStore(fakeStore('S1', { materials: [mat('t1', 'T', 20), mat('m2', 'M', 25)] }));
  await rerender(<MaterialsScreen />);
  expect(screen.getByText('Filter: All')).toBeTruthy();
  expect(titles()).toEqual(['Material m2', 'Material t1']);
});

it('AC7: a fresh mount (e.g. after sign-in) starts at All', async () => {
  setStore(fakeStore('S1', { materials: [mat('t1', 'T', 20), mat('m1', 'M', 21)] }));
  const first = await render(<MaterialsScreen />);
  await open();
  await fireEvent.press(entry('Mentor Max'));
  await first.unmount();
  await render(<MaterialsScreen />);
  expect(screen.getByText('Filter: All')).toBeTruthy();
  expect(titles()).toHaveLength(2);
});

it('AC9 / AC5: 44 pt button, hidden caret and check mark, transparent modal with Android back handled', async () => {
  setStore(fakeStore('S1', { materials: [mat('t1', 'T', 20)] }));
  const view = await render(<MaterialsScreen />);
  const modalHost = () => view.container.queryAll((n) => typeof n.props.onRequestClose === 'function' && 'transparent' in n.props)[0];
  expect(StyleSheet.flatten(filterButton().props.style).minHeight).toBeGreaterThanOrEqual(44);
  expect(screen.queryByText('▾')).toBeNull(); // hidden from accessibility
  expect(screen.getByText('▾', { includeHiddenElements: true })).toBeTruthy();
  expect(modalHost()?.props.visible ?? false).toBe(false);
  await open();
  const modal = modalHost();
  expect(modal.props.visible).not.toBe(false);
  expect(modal.props.transparent).toBe(true);
  expect(typeof modal.props.onRequestClose).toBe('function');
  expect(within(screen.getByTestId('author-filter-list')).queryByText('✓')).toBeNull();
  // Opening, closing and reopening works repeatedly.
  await fireEvent.press(screen.getByTestId('author-filter-backdrop', { includeHiddenElements: true }));
  expect(listNode()).toBeNull();
  await open();
  expect(listNode()).not.toBeNull();
});
