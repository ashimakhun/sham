// ARU-39 QA additions to aru39-course-materials.test.tsx, from the TEST DESIGN: the heading is a screen-reader header
// and rows are 44 pt buttons (AC 7, edge), long names wrap to 2 lines (AC 1), a student who becomes a listener gets
// the card and loses it again when removed (AC 3), a mentor who is a listener sees it (edge), and the row text for an
// unknown author and a missing size ("Unknown", "—").
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
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
  sizeBytes: 2048,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const rows = () => screen.queryAllByRole('button', { name: /, PDF$/ });

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

it('AC7: the heading is announced as a header, and each row is one button of at least 44 pt', async () => {
  setStore(fakeStore('T', { materialFiles: [file('one'), file('two', { createdAt: '2026-10-19T10:00:00.000Z' })] }));
  await render(<CourseDetailScreen />);
  expect(screen.getByRole('header', { name: 'MATERIALS (2)' })).toBeTruthy();
  expect(rows()).toHaveLength(2);
  for (const row of rows()) {
    const style = StyleSheet.flatten(typeof row.props.style === 'function' ? row.props.style({ pressed: false }) : row.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    // One button per item: the name and the meta line are inside it, not separate focus stops.
    expect(within(row).getByText(/^Book (one|two)$/)).toBeTruthy();
  }
});

it('AC1: a long name is limited to 2 lines and still labels the row in full', async () => {
  const long = 'L'.repeat(200);
  setStore(fakeStore('T', { materialFiles: [file('long', { name: long })] }));
  await render(<CourseDetailScreen />);
  expect(screen.getByText(long).props.numberOfLines).toBe(2);
  expect(screen.getByRole('button', { name: `${long}, PDF` })).toBeTruthy();
});

it('edge: an unknown author shows "Unknown" and a missing size shows "—"', async () => {
  setStore(fakeStore('T', { materialFiles: [file('x', { authorId: 'gone', sizeBytes: undefined as unknown as number })] }));
  await render(<CourseDetailScreen />);
  expect(screen.getByText(`Unknown · ${formatDate('2026-10-20T10:00:00.000Z')} · —`)).toBeTruthy();
});

it('AC3: a student gets the card once added as a listener, and loses it again when removed (live update)', async () => {
  const materialFiles = [file('one')];
  setStore(fakeStore('S2', { materialFiles, courseMembers: [] }));
  const view = await render(<CourseDetailScreen />);
  expect(screen.getByText('You are not in this course')).toBeTruthy();
  expect(rows()).toHaveLength(0);

  setStore(fakeStore('S2', { materialFiles, courseMembers: [member('A', 'S2')] }));
  await view.rerender(<CourseDetailScreen />);
  expect(screen.getByText('MATERIALS (1)')).toBeTruthy();
  expect(rows()).toHaveLength(1);

  setStore(fakeStore('S2', { materialFiles, courseMembers: [] }));
  await view.rerender(<CourseDetailScreen />);
  expect(screen.queryByText(/^MATERIALS/)).toBeNull();
  expect(screen.getByText('You are not in this course')).toBeTruthy();
});

it('edge: a mentor who is a listener of the course sees the card like any mentor', async () => {
  setStore(fakeStore('M2', { materialFiles: [file('one')], courseMembers: [member('A', 'M2')] }));
  await render(<CourseDetailScreen />);
  expect(screen.getByText('MATERIALS (1)')).toBeTruthy();
  expect(rows()).toHaveLength(1);
});

it('edge: items whose author is now a student still show (visibility follows the read policy, not the author role)', async () => {
  setStore(fakeStore('T', { materialFiles: [file('one', { authorId: 'S3' })] }));
  await render(<CourseDetailScreen />);
  expect(screen.getByText(`Abby Student · ${formatDate('2026-10-20T10:00:00.000Z')} · 2.0 KB`)).toBeTruthy();
});
