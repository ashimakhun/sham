// ARU-42: the author of a course-linked Knowledge base PDF chooses Everyone or Only people in the course. Who may see
// a course-only item is enforced by RLS and storage (supabase/tests/aru42_course_only_files.test.sql); the store only
// holds what the database returns, so these tests cover the choice, the labels and what the screens show.
import { fireEvent, render, screen } from '@testing-library/react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import CourseDetailScreen from '@/app/courses/[id]';
import MaterialFileScreen from '@/app/materials/files/[id]';
import EditMaterialFileScreen from '@/app/materials/files/[id]/edit';
import UploadMaterialFileScreen from '@/app/materials/files/new';
import type { MaterialFile } from '@/lib/types';

import { courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HINT = 'People in the course are its owner and listeners. The teacher always sees it.';
const radio = (name: string) => screen.getByRole('radio', { name });
const checked = (name: string) => radio(name).props.accessibilityState.checked;
const file = (id: string, over: Partial<MaterialFile> = {}): MaterialFile => ({
  id,
  authorId: 'M',
  name: `Book ${id}`,
  description: '',
  courseId: 'A',
  storagePath: `M/${id}.pdf`,
  sizeBytes: 1024,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete (params as Record<string, unknown>)[k];
});

describe('Choice on upload (AC 1)', () => {
  const open = () => Object.assign(params, { uri: 'file:///a.pdf', name: 'a.pdf', size: '10', mimeType: 'application/pdf' });

  it('appears only once a course is picked, with Everyone selected and the hint', async () => {
    open();
    setStore(fakeStore('M'));
    await render(<UploadMaterialFileScreen />);
    expect(screen.queryByRole('radio', { name: 'Everyone' })).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
    await fireEvent.press(radio('Algebra'));
    expect(screen.getByText('Who can see it')).toBeTruthy();
    expect(checked('Everyone')).toBe(true);
    expect(checked('Only people in the course')).toBe(false);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('uploads a course-only item', async () => {
    open();
    const store = fakeStore('T');
    setStore(store);
    await render(<UploadMaterialFileScreen />);
    await fireEvent.press(radio('Algebra'));
    await fireEvent.press(radio('Only people in the course'));
    await fireEvent.press(screen.getByRole('button', { name: 'Upload' }));
    expect(store.addMaterialFile).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'A', courseOnly: true }),
      expect.anything(),
    );
  });

  it('Everyone with a course sends no course-only flag', async () => {
    open();
    const store = fakeStore('M');
    setStore(store);
    await render(<UploadMaterialFileScreen />);
    await fireEvent.press(radio('Biology'));
    await fireEvent.press(screen.getByRole('button', { name: 'Upload' }));
    const [input] = jest.mocked(store.addMaterialFile).mock.calls[0];
    expect(input.courseId).toBe('B');
    expect(input.courseOnly).toBeUndefined();
  });

  it('"No course" after choosing course-only saves Everyone and hides the choice', async () => {
    open();
    const store = fakeStore('M');
    setStore(store);
    await render(<UploadMaterialFileScreen />);
    await fireEvent.press(radio('Algebra'));
    await fireEvent.press(radio('Only people in the course'));
    await fireEvent.press(radio('No course'));
    expect(screen.queryByText('Who can see it')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Upload' }));
    const [input] = jest.mocked(store.addMaterialFile).mock.calls[0];
    expect(input.courseId).toBeUndefined();
    expect(input.courseOnly).toBeUndefined();
  });
});

describe('Choice on edit (AC 2)', () => {
  it('shows the current setting and keeps it when the course changes', async () => {
    params.id = 'x';
    const store = fakeStore('M', { materialFiles: [file('x', { courseOnly: true })] });
    setStore(store);
    await render(<EditMaterialFileScreen />);
    expect(checked('Only people in the course')).toBe(true);
    await fireEvent.press(radio('Biology'));
    expect(checked('Only people in the course')).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.updateMaterialFile).toHaveBeenCalledWith('x', { name: 'Book x', description: '', courseId: 'B', courseOnly: true });
  });

  it('switching to Everyone saves without the flag (the store saves Everyone)', async () => {
    params.id = 'x';
    const store = fakeStore('M', { materialFiles: [file('x', { courseOnly: true })] });
    setStore(store);
    await render(<EditMaterialFileScreen />);
    await fireEvent.press(radio('Everyone'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.updateMaterialFile).toHaveBeenCalledWith('x', { name: 'Book x', description: '', courseId: 'A' });
  });

  it('"No course" saves Everyone', async () => {
    params.id = 'x';
    const store = fakeStore('M', { materialFiles: [file('x', { courseOnly: true })] });
    setStore(store);
    await render(<EditMaterialFileScreen />);
    await fireEvent.press(radio('No course'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.updateMaterialFile).toHaveBeenCalledWith('x', { name: 'Book x', description: '', courseId: undefined });
  });

  it('a linked course the author can\'t see stays linked as "Current course" (ARU-40 edge case)', async () => {
    params.id = 'x';
    const store = fakeStore('M', { courses: [courseB], materialFiles: [file('x', { courseId: 'H', courseOnly: true })] });
    setStore(store);
    await render(<EditMaterialFileScreen />);
    expect(checked('Current course')).toBe(true);
    expect(checked('No course')).toBe(false);
    expect(checked('Only people in the course')).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.updateMaterialFile).toHaveBeenCalledWith('x', { name: 'Book x', description: '', courseId: 'H', courseOnly: true });
  });
});

describe('Labels (AC 3)', () => {
  it('details of a course-only item say "Only people in the course" under the course', async () => {
    params.id = 'x';
    setStore(fakeStore('S1', { materialFiles: [file('x', { courseOnly: true })] }));
    await render(<MaterialFileScreen />);
    expect(screen.getByText('Course: Algebra')).toBeTruthy();
    expect(screen.getByText('Only people in the course')).toBeTruthy();
  });

  it('an Everyone item shows no extra line', async () => {
    params.id = 'x';
    setStore(fakeStore('S1', { materialFiles: [file('x')] }));
    await render(<MaterialFileScreen />);
    expect(screen.queryByText('Only people in the course')).toBeNull();
  });

  it('the Knowledge base card of a course-only item has a "Course only" label', async () => {
    setStore(fakeStore('S1', { materialFiles: [file('co', { courseOnly: true }), file('ev')] }));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
    expect(screen.getAllByText('Course only')).toHaveLength(1);
  });
});

describe('Without access (AC 5, AC 11 ARU-39 card)', () => {
  // RLS doesn't return a course-only item to a non-member, so it is never in their store.
  it('a non-member mentor sees no Materials card for a course whose only item is course-only', async () => {
    params.id = 'A';
    setStore(fakeStore('N', { materialFiles: [], courseMembers: [member('A', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByText(/^MATERIALS/)).toBeNull();
  });

  it('the listener sees the same item on the card', async () => {
    params.id = 'A';
    setStore(fakeStore('S1', { materialFiles: [file('co', { courseOnly: true })], courseMembers: [member('A', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByRole('button', { name: 'Book co, PDF' })).toBeTruthy();
  });

  it('with only course-only items they can\'t see, a student gets the empty state; a link shows "Material not found"', async () => {
    setStore(fakeStore('S2', { materialFiles: [] }));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
    expect(screen.getByText('No books or files yet')).toBeTruthy();
    params.id = 'co';
    await render(<MaterialFileScreen />);
    expect(screen.getByText('Material not found')).toBeTruthy();
  });
});
