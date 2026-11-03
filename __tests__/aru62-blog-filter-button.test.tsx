// ARU-62: the Blog author chip row (ARU-29) becomes one "Filter: <All | author>" button that opens a list of
// authors. Filtering logic is unchanged; app-only, no data change.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

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
const all = [t1, m1, t2];

const filterButton = () => screen.getByRole('button', { name: /^Filter by author, / });
const list = () => screen.queryByTestId('author-filter-list');
const entries = () =>
  within(screen.getByTestId('author-filter-list'))
    .getAllByRole('button')
    .map((b) => ({ label: b.props.accessibilityLabel as string, selected: !!b.props.accessibilityState?.selected }));
const entry = (name: string) => within(screen.getByTestId('author-filter-list')).getByRole('button', { name });
const titles = () => screen.queryAllByText(/^Material /).map((n) => n.props.children);
const open = () => fireEvent.press(filterButton());

beforeEach(() => jest.clearAllMocks());

describe('AC1/AC2/AC9: one button that opens the list', () => {
  it.each(['S1', 'M', 'T'] as const)('%s: "Filter: All", no author names until opened', async (who) => {
    setStore(fakeStore(who, { materials: all }));
    await render(<MaterialsScreen />);
    expect(filterButton().props.accessibilityLabel).toBe('Filter by author, All');
    expect(screen.getByText('Filter: All')).toBeTruthy();
    expect(list()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mentor Max' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Teacher Tess' })).toBeNull();
  });

  it('opens with All first, then authors by name (case-insensitive), All checked', async () => {
    const lower: User = { id: 'L', name: 'aaron lower', role: 'mentor' };
    const everyone = [...Object.values(users), lower];
    setStore(
      fakeStore('S1', {
        users: everyone,
        getUser: (id) => everyone.find((u) => u.id === id),
        materials: [...all, mat('l1', 'L', '2026-10-18T10:00:00.000Z'), mat('x1', 'GONE', '2026-10-17T10:00:00.000Z')],
      }),
    );
    await render(<MaterialsScreen />);
    await open();
    expect(entries()).toEqual([
      { label: 'All', selected: true },
      { label: 'aaron lower', selected: false },
      { label: 'Mentor Max', selected: false },
      { label: 'Teacher Tess', selected: false },
      { label: 'Unknown', selected: false },
    ]);
    expect(within(screen.getByTestId('author-filter-list')).getAllByText('✓', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('two authors with the same name are two entries', async () => {
    const twin: User = { id: 'M9', name: 'Mentor Max', role: 'mentor' };
    const everyone = [...Object.values(users), twin];
    setStore(
      fakeStore('S1', {
        users: everyone,
        getUser: (id) => everyone.find((u) => u.id === id),
        materials: [m1, mat('x9', 'M9', '2026-10-25T10:00:00.000Z')],
      }),
    );
    await render(<MaterialsScreen />);
    await open();
    expect(entries().filter((e) => e.label === 'Mentor Max')).toHaveLength(2);
  });

  it('a single author still gets the button with All and that author', async () => {
    setStore(fakeStore('S1', { materials: [t1] }));
    await render(<MaterialsScreen />);
    await open();
    expect(entries().map((e) => e.label)).toEqual(['All', 'Teacher Tess']);
  });
});

describe('AC3/AC4/AC5: picking, clearing, closing', () => {
  it('picking an author closes the list, filters newest first and shows the name on the button', async () => {
    setStore(fakeStore('S1', { materials: all }));
    await render(<MaterialsScreen />);
    await open();
    await fireEvent.press(entry('Teacher Tess'));
    expect(list()).toBeNull();
    expect(titles()).toEqual(['Material t2', 'Material t1']);
    expect(screen.getByText('Filter: Teacher Tess')).toBeTruthy();
    expect(filterButton().props.accessibilityLabel).toBe('Filter by author, Teacher Tess');
    await open();
    expect(entries().find((e) => e.selected)?.label).toBe('Teacher Tess');
  });

  it('All clears the filter', async () => {
    setStore(fakeStore('S1', { materials: all }));
    await render(<MaterialsScreen />);
    await open();
    await fireEvent.press(entry('Mentor Max'));
    await open();
    await fireEvent.press(entry('All'));
    expect(list()).toBeNull();
    expect(titles()).toEqual(['Material t2', 'Material m1', 'Material t1']);
    expect(screen.getByText('Filter: All')).toBeTruthy();
  });

  it('tapping outside closes without a change', async () => {
    setStore(fakeStore('S1', { materials: all }));
    await render(<MaterialsScreen />);
    await open();
    await fireEvent.press(entry('Mentor Max'));
    await open();
    await fireEvent.press(screen.getByTestId('author-filter-backdrop', { includeHiddenElements: true }));
    expect(list()).toBeNull();
    expect(titles()).toEqual(['Material m1']);
    expect(screen.getByText('Filter: Mentor Max')).toBeTruthy();
  });

  it('Android back (onRequestClose) closes without a change', async () => {
    setStore(fakeStore('S1', { materials: all }));
    await render(<MaterialsScreen />);
    await open();
    await fireEvent(screen.getByTestId('author-filter-backdrop', { includeHiddenElements: true }), 'requestClose');
    expect(list()).toBeNull();
    expect(titles()).toHaveLength(3);
    expect(screen.getByText('Filter: All')).toBeTruthy();
  });

  it('tapping the selected entry closes without a change', async () => {
    const store = fakeStore('S1', { materials: all });
    setStore(store);
    await render(<MaterialsScreen />);
    await open();
    await fireEvent.press(entry('All'));
    expect(list()).toBeNull();
    expect(titles()).toHaveLength(3);
    // AC 7: no network call when filtering.
    expect(store.refresh).not.toHaveBeenCalled();
  });
});

describe('AC6/AC9/AC10: long names, accessibility, layout', () => {
  it('long names are one line with an ellipsis, on the button and in the list; rows are 44 pt', async () => {
    const long: User = { id: 'LG', name: 'A'.repeat(80), role: 'mentor' };
    const everyone = [...Object.values(users), long];
    setStore(
      fakeStore('S1', {
        users: everyone,
        getUser: (id) => everyone.find((u) => u.id === id),
        materials: [...all, mat('lg', 'LG', '2026-10-30T10:00:00.000Z')],
      }),
    );
    await render(<MaterialsScreen />);
    await open();
    const row = entry(long.name);
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(within(row).getByText(long.name).props.numberOfLines).toBe(1);
    await fireEvent.press(row);
    const label = screen.getByText(`Filter: ${long.name}`);
    expect(label.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(filterButton().props.style)).toMatchObject({ maxWidth: '100%', minHeight: 44 });
  });

  it('teacher/mentor: Share above the button; student: no Share; the button comes before the first post', async () => {
    setStore(fakeStore('T', { materials: all }));
    const view = await render(<MaterialsScreen />);
    let order = screen.getAllByRole('button');
    const share = screen.getByRole('button', { name: '+ Share material' });
    expect(order.indexOf(share)).toBeLessThan(order.indexOf(filterButton()));
    expect(order.indexOf(filterButton())).toBeLessThan(order.indexOf(screen.getByRole('button', { name: 'Material t2' })));
    await view.unmount();
    setStore(fakeStore('S1', { materials: all }));
    await render(<MaterialsScreen />);
    order = screen.getAllByRole('button');
    expect(screen.queryByRole('button', { name: '+ Share material' })).toBeNull();
    expect(order.indexOf(filterButton())).toBeLessThan(order.indexOf(screen.getByRole('button', { name: 'Material t2' })));
  });
});

describe('AC7/AC8: kept as today, hidden when nothing to filter', () => {
  it("the selected author's last post disappearing while the list is open falls back to All", async () => {
    setStore(fakeStore('S1', { materials: all }));
    const { rerender } = await render(<MaterialsScreen />);
    await open();
    await fireEvent.press(entry('Mentor Max'));
    await open();
    setStore(fakeStore('S1', { materials: [t1, t2] }));
    await rerender(<MaterialsScreen />);
    expect(entries()).toEqual([
      { label: 'All', selected: true },
      { label: 'Teacher Tess', selected: false },
    ]);
    expect(screen.getByText('Filter: All')).toBeTruthy();
    expect(titles()).toEqual(['Material t2', 'Material t1']);
  });

  it('a refresh keeps the author while they still have posts', async () => {
    setStore(fakeStore('S1', { materials: all }));
    const { rerender } = await render(<MaterialsScreen />);
    await open();
    await fireEvent.press(entry('Teacher Tess'));
    setStore(fakeStore('S1', { materials: [...all, mat('t3', 'T', '2026-10-28T10:00:00.000Z')] }));
    await rerender(<MaterialsScreen />);
    expect(screen.getByText('Filter: Teacher Tess')).toBeTruthy();
    expect(titles()).toEqual(['Material t3', 'Material t2', 'Material t1']);
  });

  it('switching to Knowledge base and back keeps the filter; Knowledge base has no button', async () => {
    setStore(fakeStore('S1', { materials: all }));
    await render(<MaterialsScreen />);
    await open();
    await fireEvent.press(entry('Mentor Max'));
    await fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
    expect(screen.queryByRole('button', { name: /^Filter by author/ })).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: 'Blog' }));
    expect(screen.getByText('Filter: Mentor Max')).toBeTruthy();
    expect(titles()).toEqual(['Material m1']);
  });

  it('no posts → no button', async () => {
    setStore(fakeStore('T', { materials: [] }));
    await render(<MaterialsScreen />);
    expect(screen.queryByRole('button', { name: /^Filter by author/ })).toBeNull();
    expect(screen.getByText('No materials yet')).toBeTruthy();
  });
});
