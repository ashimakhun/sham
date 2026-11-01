// ARU-39: the course details screen lists the Knowledge base PDFs linked to the course (ARU-30) in a MATERIALS (N)
// card between Listeners and HOMEWORK. Reads the store only; no database change.
// S1 is a listener of A (owned by M); S2 is in nothing.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import CourseDetailScreen from '@/app/courses/[id]';
import MaterialFileScreen from '@/app/materials/files/[id]';
import { formatDate } from '@/lib/theme';
import type { MaterialFile } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const file = (id: string, over: Partial<MaterialFile> = {}): MaterialFile => ({
  id,
  authorId: 'M',
  name: `Book ${id}`,
  description: '',
  courseId: 'A',
  storagePath: `M/${id}.pdf`,
  sizeBytes: 3 * 1024 * 1024,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
// The store gives materialFiles newest first.
const files = [
  file('new', { authorId: 'T', createdAt: '2026-10-22T10:00:00.000Z' }),
  file('mid', { authorId: 'X', sizeBytes: Number.NaN, createdAt: '2026-10-21T10:00:00.000Z' }),
  file('other', { courseId: 'B' }),
  file('none', { courseId: undefined }),
  file('old'),
];
const members = [member('A', 'S1')];
const rows = () => screen.queryAllByRole('button', { name: /, PDF$/ }).map((r) => r.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('Materials card (AC 1, 2, 3, 7)', () => {
  it.each(['T', 'M', 'N', 'S1'] as const)('%s sees only this course\'s items, newest first, with author · date · size', async (who) => {
    setStore(fakeStore(who, { materialFiles: files, courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.getByRole('header', { name: 'MATERIALS (3)' })).toBeTruthy();
    expect(rows()).toEqual(['Book new, PDF', 'Book mid, PDF', 'Book old, PDF']);
    expect(screen.getByText(`Teacher Tess · ${formatDate('2026-10-22T10:00:00.000Z')} · 3.0 MB`)).toBeTruthy();
    // Unknown author and missing size.
    expect(screen.getByText(`Unknown · ${formatDate('2026-10-21T10:00:00.000Z')} · —`)).toBeTruthy();
    expect(screen.getByText('Book new').props.numberOfLines).toBe(2);
  });

  it('sits between the Listeners section and the HOMEWORK heading', async () => {
    setStore(fakeStore('T', { materialFiles: files, courseMembers: members }));
    await render(<CourseDetailScreen />);
    const order = screen.getAllByText(/^(LISTENERS \(\d+\)|MATERIALS \(\d+\)|HOMEWORK)$/).map((n) => n.props.children);
    expect(order.map((c) => (Array.isArray(c) ? c.join('') : c))).toEqual(['LISTENERS (1)', 'MATERIALS (3)', 'HOMEWORK']);
  });

  it('no card when nothing is linked to the course', async () => {
    params.id = 'B';
    setStore(fakeStore('T', { materialFiles: [file('a'), file('none', { courseId: undefined })] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByText(/^MATERIALS/)).toBeNull();
    expect(rows()).toEqual([]);
    expect(screen.getByText('HOMEWORK')).toBeTruthy();
  });

  it('a student who is not a listener sees the limited view, without the card (ARU-24)', async () => {
    setStore(fakeStore('S2', { materialFiles: files, courseMembers: members }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('You are not in this course')).toBeTruthy();
    expect(screen.queryByText(/^MATERIALS/)).toBeNull();
    expect(rows()).toEqual([]);
  });
});

describe('Opening an item (AC 4, 6)', () => {
  it('tapping a row opens its Knowledge base details', async () => {
    setStore(fakeStore('S1', { materialFiles: files, courseMembers: members }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Book old, PDF' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/files/[id]', params: { id: 'old' } });
  });

  it('an item deleted before the update arrives shows "Material not found"', async () => {
    params.id = 'old';
    setStore(fakeStore('S1', { materialFiles: [], courseMembers: members }));
    await render(<MaterialFileScreen />);
    expect(screen.getByText('Material not found')).toBeTruthy();
  });
});

describe('Live updates (AC 5)', () => {
  it('adds, renames and removes rows, and hides the card when the last one goes', async () => {
    setStore(fakeStore('M', { materialFiles: [file('old')] }));
    const view = await render(<CourseDetailScreen />);
    expect(rows()).toEqual(['Book old, PDF']);

    setStore(fakeStore('M', { materialFiles: [file('new', { createdAt: '2026-10-23T10:00:00.000Z' }), file('old', { name: 'Renamed' })] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.getByText('MATERIALS (2)')).toBeTruthy();
    expect(rows()).toEqual(['Book new, PDF', 'Renamed, PDF']);

    // Re-linked to another course, then deleted.
    setStore(fakeStore('M', { materialFiles: [file('new', { courseId: 'B' })] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByText(/^MATERIALS/)).toBeNull();
  });

  it('pull to refresh calls the store refresh, which reloads the Knowledge base', async () => {
    const store = fakeStore('T', { materialFiles: [file('old')] });
    setStore(store);
    const { container } = await render(<CourseDetailScreen />);
    const list = container.queryAll((n) => typeof n.props.onRefresh === 'function')[0];
    await list.props.onRefresh();
    expect(store.refresh).toHaveBeenCalled();
  });
});
