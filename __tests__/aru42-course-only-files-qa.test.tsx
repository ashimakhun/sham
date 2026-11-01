// QA ARU-42: course-only Knowledge base PDFs, screen-side gaps (radio accessibility and size, changing course on
// upload, "Current course" behaviour, the card's spoken text, the hidden-course interplay with ARU-40).
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import CourseDetailScreen from '@/app/courses/[id]';
import MaterialFileScreen from '@/app/materials/files/[id]';
import EditMaterialFileScreen from '@/app/materials/files/[id]/edit';
import UploadMaterialFileScreen from '@/app/materials/files/new';
import type { Course, MaterialFile } from '@/lib/types';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const radio = (name: string) => screen.getByRole('radio', { name });
const checked = (name: string) => radio(name).props.accessibilityState.checked;
const H: Course = { id: 'H', title: 'Secret', description: '', createdById: 'M', createdAt: '2026-10-04T10:00:00.000Z', hidden: true };
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
const openUpload = () => Object.assign(params, { uri: 'file:///a.pdf', name: 'a.pdf', size: '10', mimeType: 'application/pdf' });

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete (params as Record<string, unknown>)[k];
});

describe('edge case iOS/Android: the choice', () => {
  it('is a radio group named "Who can see it" with 44 pt rows; tapping moves the checked state', async () => {
    openUpload();
    setStore(fakeStore('M'));
    const view = await render(<UploadMaterialFileScreen />);
    await fireEvent.press(radio('Algebra'));
    expect(
      view.container.queryAll((n) => n.props.accessibilityRole === 'radiogroup' && n.props.accessibilityLabel === 'Who can see it'),
    ).not.toHaveLength(0);
    for (const name of ['Everyone', 'Only people in the course']) {
      expect(StyleSheet.flatten(radio(name).props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
    await fireEvent.press(radio('Only people in the course'));
    expect(checked('Only people in the course')).toBe(true);
    expect(checked('Everyone')).toBe(false);
    await fireEvent.press(radio('Everyone'));
    expect(checked('Everyone')).toBe(true);
  });
});

describe('AC 1: upload', () => {
  it('course-only is kept when the course changes before uploading', async () => {
    openUpload();
    const store = fakeStore('M');
    setStore(store);
    await render(<UploadMaterialFileScreen />);
    await fireEvent.press(radio('Algebra'));
    await fireEvent.press(radio('Only people in the course'));
    await fireEvent.press(radio('Biology'));
    expect(checked('Only people in the course')).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Upload' }));
    expect(store.addMaterialFile).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'B', courseOnly: true }),
      expect.anything(),
    );
  });

  it('a failed upload keeps the course and the choice for the retry', async () => {
    openUpload();
    const store = fakeStore('M', { addMaterialFile: jest.fn(async () => { throw new Error('Network request failed'); }) });
    setStore(store);
    await render(<UploadMaterialFileScreen />);
    await fireEvent.press(radio('Algebra'));
    await fireEvent.press(radio('Only people in the course'));
    await fireEvent.press(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(checked('Algebra')).toBe(true);
    expect(checked('Only people in the course')).toBe(true);
  });
});

describe('AC 2 / edge case: edit with a linked course the author can\'t see', () => {
  const setup = () => {
    params.id = 'x';
    const store = fakeStore('N', { courses: [courseB], materialFiles: [file('x', { authorId: 'N', courseId: 'H', courseOnly: true })] });
    setStore(store);
    return store;
  };

  it('tapping "Current course" changes nothing', async () => {
    const store = setup();
    await render(<EditMaterialFileScreen />);
    await fireEvent.press(radio('Current course'));
    expect(checked('Current course')).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.updateMaterialFile).toHaveBeenCalledWith('x', { name: 'Book x', description: '', courseId: 'H', courseOnly: true });
  });

  it('switching to Everyone keeps the link and saves Everyone', async () => {
    const store = setup();
    await render(<EditMaterialFileScreen />);
    await fireEvent.press(radio('Everyone'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.updateMaterialFile).toHaveBeenCalledWith('x', { name: 'Book x', description: '', courseId: 'H' });
  });

  it('picking a listed course moves the item and keeps course-only; "Current course" is then gone', async () => {
    const store = setup();
    await render(<EditMaterialFileScreen />);
    await fireEvent.press(radio('Biology'));
    expect(screen.queryByRole('radio', { name: 'Current course' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.updateMaterialFile).toHaveBeenCalledWith('x', { name: 'Book x', description: '', courseId: 'B', courseOnly: true });
  });

  it('an item linked to a listed course shows no "Current course" option', async () => {
    params.id = 'y';
    setStore(fakeStore('M', { materialFiles: [file('y')] }));
    await render(<EditMaterialFileScreen />);
    expect(screen.queryByRole('radio', { name: 'Current course' })).toBeNull();
    expect(checked('Algebra')).toBe(true);
    expect(checked('Everyone')).toBe(true);
  });
});

describe('AC 3: labels', () => {
  it('"Course only" is part of the card\'s spoken text; an Everyone card has none', async () => {
    setStore(fakeStore('S1', { materialFiles: [file('co', { courseOnly: true }), file('ev')] }));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
    // The label sits inside the course-only card (which has no explicit label, so its text is read), not the other.
    const co = screen.getByText('Book co');
    const ev = screen.getByText('Book ev');
    const cardOf = (n: typeof co) => {
      let p = n.parent;
      while (p && !p.props.onResponderRelease) p = p.parent; // the card's Pressable
      return p!;
    };
    expect(within(cardOf(co)).queryByText('Course only')).toBeTruthy();
    expect(within(cardOf(ev)).queryByText('Course only')).toBeNull();
    expect(cardOf(co).props.accessibilityLabel).toBeUndefined();
  });

  it('a course-only item on a course the viewer can\'t see (author outside the hidden course) shows the line but no course', async () => {
    params.id = 'x';
    setStore(fakeStore('N', { courses: [courseB], materialFiles: [file('x', { authorId: 'N', courseId: 'H', courseOnly: true })] }));
    await render(<MaterialFileScreen />);
    expect(screen.queryByText(/^Course: /)).toBeNull();
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.getByText('Only people in the course')).toBeTruthy();
  });
});

describe('AC 4 / AC 9: participants of a hidden course', () => {
  it('the hidden course\'s listener sees its course-only item on the course screen and in the list with the course name', async () => {
    const items = [file('h', { courseId: 'H', courseOnly: true, name: 'Hidden book' })];
    params.id = 'H';
    setStore(fakeStore('S1', { courses: [H, courseA], courseMembers: [member('H', 'S1')], materialFiles: items }));
    await render(<CourseDetailScreen />);
    expect(screen.getByRole('header', { name: 'MATERIALS (1)' })).toBeTruthy();
    expect(screen.getByText('Hidden book')).toBeTruthy();
  });

  it('a non-participant with an Everyone item on a hidden course sees the item, no course name, no label', async () => {
    setStore(fakeStore('S2', { courses: [courseA, courseB], materialFiles: [file('e', { courseId: 'H', name: 'Open book' })] }));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
    expect(screen.getByText('Open book')).toBeTruthy();
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.queryByText('Course only')).toBeNull();
  });
});
