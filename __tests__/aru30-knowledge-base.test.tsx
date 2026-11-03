// ARU-30: Knowledge base of PDF files on the Materials tab. Teachers and mentors upload PDFs (name, optional
// description and course); everyone opens them; only the author edits or deletes. Access rules:
// supabase/tests/aru30_material_files.test.sql.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router, usePreventRemove } from 'expo-router';
import { Alert, Linking } from 'react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialFileScreen from '@/app/materials/files/[id]';
import EditMaterialFileScreen from '@/app/materials/files/[id]/edit';
import UploadMaterialFileScreen from '@/app/materials/files/new';
import { fileFieldsError, formatSize, isAllowedPdf, nameFromFile, PDF_MAX_BYTES } from '@/lib/files';
import type { MaterialFile } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const PDF_RULE = 'The file must be a PDF up to 25 MB.';
const OPEN_FAILED = "Couldn't open the file. Check your connection and try again.";
const UPLOAD = '+ Upload PDF';

const file = (id: string, over: Partial<MaterialFile> = {}): MaterialFile => ({
  id,
  authorId: 'M',
  name: `Book ${id}`,
  description: '',
  storagePath: `M/${id}.pdf`,
  sizeBytes: 2 * 1024 * 1024,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const kb = () => fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
const pick = jest.mocked(DocumentPicker.getDocumentAsync);
const picked = (asset: Partial<DocumentPicker.DocumentPickerAsset>) =>
  pick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///cache/a.pdf', name: 'a.pdf', lastModified: 0, ...asset }],
  } as DocumentPicker.DocumentPickerResult);

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete (params as Record<string, unknown>)[k];
});

describe('files helpers', () => {
  it.each([
    [{ name: 'a.pdf', mimeType: 'application/pdf', size: 10 }, true],
    [{ name: 'a.PDF', size: 10 }, true],
    [{ name: 'a.pdf', mimeType: 'application/pdf' }, true],
    [{ name: 'a.pdf', mimeType: 'application/pdf', size: PDF_MAX_BYTES }, true],
    [{ name: 'a.pdf', mimeType: 'application/pdf', size: PDF_MAX_BYTES + 1 }, false],
    [{ name: 'a.docx', mimeType: 'application/msword', size: 10 }, false],
    [{ name: 'a.pdf', mimeType: 'image/png', size: 10 }, false],
    [{ name: 'notes', size: 10 }, false],
  ])('isAllowedPdf(%j) → %s', (f, ok) => expect(isAllowedPdf(f)).toBe(ok));

  it.each([
    ['Algebra.pdf', 'Algebra'],
    ['  Book.PDF ', 'Book'],
    ['', 'Untitled'],
    [undefined, 'Untitled'],
    ['.pdf', 'Untitled'],
    ['x'.repeat(250) + '.pdf', 'x'.repeat(200)],
  ])('nameFromFile(%j) → %j', (n, expected) => expect(nameFromFile(n)).toBe(expected));

  it.each([
    [undefined, '—'],
    [500, '500 B'],
    [1536, '1.5 KB'],
    [300 * 1024, '300 KB'],
    [2.5 * 1024 * 1024, '2.5 MB'],
    [25 * 1024 * 1024, '25 MB'],
  ])('formatSize(%j) → %j', (b, expected) => expect(formatSize(b)).toBe(expected));

  it('checks name and description like the database', () => {
    expect(fileFieldsError({ name: '  ', description: '' })).toBe('Enter a name.');
    expect(fileFieldsError({ name: 'x'.repeat(201), description: '' })).toBe('The name can be at most 200 characters.');
    expect(fileFieldsError({ name: ` ${'😀'.repeat(200)} `, description: '' })).toBeNull();
    expect(fileFieldsError({ name: 'x', description: 'd'.repeat(2001) })).toBe(
      'The description can be at most 2,000 characters.',
    );
    expect(fileFieldsError({ name: 'x', description: 'd'.repeat(2000) })).toBeNull();
  });
});

describe('Knowledge base list (AC 1)', () => {
  it('shows all items newest first with name, description, author, date, size and course', async () => {
    setStore(
      fakeStore('S1', {
        materialFiles: [
          file('new', { description: 'Read chapters 1–3', courseId: 'A', authorId: 'T', createdAt: '2026-10-22T10:00:00.000Z' }),
          file('old'),
        ],
      }),
    );
    await render(<MaterialsScreen />);
    await kb();
    expect(screen.queryAllByText(/^Book /).map((n) => n.props.children)).toEqual(['Book new', 'Book old']);
    expect(screen.getByText('Read chapters 1–3').props.numberOfLines).toBe(2);
    expect(screen.getByText(/^Teacher Tess · .* · 2\.0 MB$/)).toBeTruthy();
    expect(screen.getByText(/^Mentor Max · .* · 2\.0 MB$/)).toBeTruthy();
    expect(screen.getByText('Course: Algebra')).toBeTruthy();
    expect(screen.getAllByText(/^Course: /)).toHaveLength(1);
  });

  it.each([
    ['T', true],
    ['M', true],
    ['S1', false],
  ] as const)('%s with no items: empty state, upload button %s', async (who, canUpload) => {
    setStore(fakeStore(who));
    await render(<MaterialsScreen />);
    await kb();
    expect(screen.getByText('No books or files yet')).toBeTruthy();
    expect(!!screen.queryByText('Upload a PDF for your class.')).toBe(canUpload);
    expect(!!screen.queryByRole('button', { name: UPLOAD })).toBe(canUpload);
  });

  it('upload button is only on Knowledge base, not on Blog', async () => {
    setStore(fakeStore('T'));
    await render(<MaterialsScreen />);
    expect(screen.queryByRole('button', { name: UPLOAD })).toBeNull();
    await kb();
    expect(screen.getByRole('button', { name: UPLOAD })).toBeTruthy();
  });

  it('tapping an item opens its details', async () => {
    setStore(fakeStore('S1', { materialFiles: [file('x')] }));
    await render(<MaterialsScreen />);
    await kb();
    await fireEvent.press(screen.getByText('Book x'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/files/[id]', params: { id: 'x' } });
  });

  it('a live update shows the new item without leaving Knowledge base (AC 9)', async () => {
    setStore(fakeStore('S1'));
    const { rerender } = await render(<MaterialsScreen />);
    await kb();
    setStore(fakeStore('S1', { materialFiles: [file('live')] }));
    await rerender(<MaterialsScreen />);
    expect(screen.getByText('Book live')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Knowledge base' }).props.accessibilityState).toEqual({ selected: true });
  });
});

describe('Picking a PDF (AC 2, AC 4)', () => {
  it('opens the picker limited to PDFs and goes to the upload screen with the file', async () => {
    setStore(fakeStore('M'));
    picked({ name: 'Algebra.pdf', size: 1234, mimeType: 'application/pdf' });
    await render(<MaterialsScreen />);
    await kb();
    await fireEvent.press(screen.getByRole('button', { name: UPLOAD }));
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/pdf', base64: false }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/materials/files/new',
      params: { uri: 'file:///cache/a.pdf', name: 'Algebra.pdf', size: '1234', mimeType: 'application/pdf' },
    });
  });

  it('cancelling the picker changes nothing', async () => {
    setStore(fakeStore('M'));
    pick.mockResolvedValueOnce({ canceled: true, assets: null } as DocumentPicker.DocumentPickerResult);
    await render(<MaterialsScreen />);
    await kb();
    await fireEvent.press(screen.getByRole('button', { name: UPLOAD }));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByText(PDF_RULE)).toBeNull();
    expect(screen.getByRole('tab', { name: 'Knowledge base' }).props.accessibilityState).toEqual({ selected: true });
  });

  it.each([
    ['not a PDF', { name: 'notes.docx', mimeType: 'application/msword', size: 10 }],
    ['over 25 MB', { name: 'big.pdf', mimeType: 'application/pdf', size: PDF_MAX_BYTES + 1 }],
  ])('a file %s is rejected before upload', async (_l, asset) => {
    setStore(fakeStore('T'));
    picked(asset);
    await render(<MaterialsScreen />);
    await kb();
    await fireEvent.press(screen.getByRole('button', { name: UPLOAD }));
    expect(screen.getByText(PDF_RULE)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('Upload screen (AC 2–4)', () => {
  const open = (over: Record<string, string> = {}) =>
    Object.assign(params, { uri: 'file:///cache/a.pdf', name: 'Algebra.pdf', size: '1048576', mimeType: 'application/pdf', ...over });

  it('shows the file name and size, the prefilled name and the course picker with "No course" first', async () => {
    open();
    setStore(fakeStore('M'));
    await render(<UploadMaterialFileScreen />);
    expect(screen.getByText('Algebra.pdf')).toBeTruthy();
    expect(screen.getByText('PDF · 1.0 MB')).toBeTruthy();
    expect(screen.getByLabelText('Name').props.value).toBe('Algebra');
    expect(screen.getByLabelText('Description (optional)').props.value).toBe('');
    expect(screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual(['No course', 'Algebra', 'Biology']);
    expect(screen.getByRole('radio', { name: 'No course' }).props.accessibilityState).toEqual({ checked: true });
  });

  it('missing name and size from the picker: "Untitled" and "—"', async () => {
    open({ name: '', size: '' });
    setStore(fakeStore('M'));
    await render(<UploadMaterialFileScreen />);
    expect(screen.getByLabelText('Name').props.value).toBe('Untitled');
    expect(screen.getByText('PDF · —')).toBeTruthy();
  });

  it('uploads with the entries, shows "Uploading…" while busy and returns to the Knowledge base', async () => {
    open();
    let finish: () => void = () => {};
    const store = fakeStore('M', {
      addMaterialFile: jest.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    setStore(store);
    await render(<UploadMaterialFileScreen />);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Algebra workbook');
    await fireEvent.changeText(screen.getByLabelText('Description (optional)'), 'Chapters 1–3');
    await fireEvent.press(screen.getByRole('radio', { name: 'Biology' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.getByRole('button', { name: 'Uploading…' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(store.addMaterialFile).toHaveBeenCalledWith(
      {
        id: expect.any(String),
        file: { uri: 'file:///cache/a.pdf', name: 'Algebra.pdf', size: 1048576, mimeType: 'application/pdf' },
        name: 'Algebra workbook',
        description: 'Chapters 1–3',
        courseId: 'B',
      },
      { isCancelled: expect.any(Function) },
    );
    await act(async () => finish());
    expect(router.back).toHaveBeenCalled();
  });

  it('a failed upload keeps the entries, shows the error, and a retry reuses the same id', async () => {
    open();
    const store = fakeStore('M', {
      addMaterialFile: jest.fn().mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce(undefined),
    });
    setStore(store);
    await render(<UploadMaterialFileScreen />);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Mine');
    await fireEvent.press(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(screen.getByLabelText('Name').props.value).toBe('Mine');
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Upload' }));
    const [first, second] = jest.mocked(store.addMaterialFile).mock.calls;
    expect(second[0].id).toBe(first[0].id);
  });

  it('Upload is disabled with a blank name', async () => {
    open();
    setStore(fakeStore('M'));
    await render(<UploadMaterialFileScreen />);
    await fireEvent.changeText(screen.getByLabelText('Name'), '   ');
    expect(screen.getByRole('button', { name: 'Upload' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('leaving mid-upload asks "Discard upload?" and, once confirmed, marks the upload cancelled', async () => {
    open();
    const store = fakeStore('M', { addMaterialFile: jest.fn(() => new Promise<void>(() => {})) });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<UploadMaterialFileScreen />);
    const prevent = jest.mocked(usePreventRemove);
    expect(prevent).toHaveBeenLastCalledWith(false, expect.any(Function));
    await fireEvent.press(screen.getByRole('button', { name: 'Upload' }));
    expect(prevent).toHaveBeenLastCalledWith(true, expect.any(Function));
    const { isCancelled } = jest.mocked(store.addMaterialFile).mock.calls[0][1]!;
    expect(isCancelled!()).toBe(false);
    const repeat = jest.fn();
    await act(async () => prevent.mock.lastCall![1]!({ data: { action: { type: 'GO_BACK' } }, repeat } as never));
    expect(alert).toHaveBeenCalledWith('Discard upload?', expect.any(String), expect.any(Array), expect.any(Object));
    const discard = alert.mock.lastCall![2]!.find((b) => b.text === 'Discard')!;
    await act(async () => discard.onPress!());
    expect(isCancelled!()).toBe(true);
    expect(repeat).toHaveBeenCalled();
  });
});

describe('Details (AC 5, 7, 8)', () => {
  const item = file('x', { description: 'All about equations', courseId: 'A' });

  it('shows name, description, author, date, size and the course link', async () => {
    params.id = 'x';
    setStore(fakeStore('S1', { materialFiles: [item] }));
    await render(<MaterialFileScreen />);
    expect(screen.getByText('Book x')).toBeTruthy();
    expect(screen.getByText('All about equations')).toBeTruthy();
    expect(screen.getByText(/^Mentor Max · .* · 2\.0 MB$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Course: Algebra' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });

  it('no course link when the item has no course', async () => {
    params.id = 'x';
    setStore(fakeStore('S1', { materialFiles: [file('x')] }));
    await render(<MaterialFileScreen />);
    expect(screen.queryByText(/^Course: /)).toBeNull();
  });

  it('Open PDF creates a signed link on tap and opens it', async () => {
    params.id = 'x';
    const store = fakeStore('S1', { materialFiles: [item] });
    setStore(store);
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    await render(<MaterialFileScreen />);
    expect(store.getMaterialFileUrl).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Open PDF' }));
    expect(store.getMaterialFileUrl).toHaveBeenCalledWith('M/x.pdf');
    expect(openUrl).toHaveBeenCalledWith('https://signed.example/materials/M/x.pdf');
  });

  it('Open PDF failing shows the connection message', async () => {
    params.id = 'x';
    setStore(fakeStore('S1', { materialFiles: [item], getMaterialFileUrl: jest.fn().mockRejectedValue(new Error('offline')) }));
    await render(<MaterialFileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open PDF' }));
    expect(screen.getByText(OPEN_FAILED)).toBeTruthy();
  });

  // ARU-86: the teacher now deletes anyone's PDF (but still edits only their own): aru86-teacher-deletes-any-pdf.
  it.each(['S1', 'N'] as const)('%s (not the author) sees no Edit or Delete', async (who) => {
    params.id = 'x';
    setStore(fakeStore(who, { materialFiles: [item] }));
    await render(<MaterialFileScreen />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('the author edits and deletes after confirming', async () => {
    params.id = 'x';
    const store = fakeStore('M', { materialFiles: [item] });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<MaterialFileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/files/[id]/edit', params: { id: 'x' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(alert).toHaveBeenCalledWith('Delete file?', expect.any(String), expect.any(Array), expect.any(Object));
    const del = alert.mock.lastCall![2]!.find((b) => b.text === 'Delete')!;
    await act(async () => del.onPress!());
    expect(store.deleteMaterialFile).toHaveBeenCalledWith('x');
    expect(router.back).toHaveBeenCalled();
  });

  it('a deleted item shows "Material not found"', async () => {
    params.id = 'gone';
    setStore(fakeStore('S1', { materialFiles: [item] }));
    await render(<MaterialFileScreen />);
    expect(screen.getByText('Material not found')).toBeTruthy();
  });
});

describe('Edit (AC 6)', () => {
  const item = file('x', { description: 'Old', courseId: 'A' });

  it('prefills, saves name, description and "No course", and goes back', async () => {
    params.id = 'x';
    const store = fakeStore('M', { materialFiles: [item] });
    setStore(store);
    await render(<EditMaterialFileScreen />);
    expect(screen.getByLabelText('Name').props.value).toBe('Book x');
    expect(screen.getByRole('radio', { name: 'Algebra' }).props.accessibilityState).toEqual({ checked: true });
    await fireEvent.changeText(screen.getByLabelText('Name'), 'New name');
    await fireEvent.changeText(screen.getByLabelText('Description (optional)'), '');
    await fireEvent.press(screen.getByRole('radio', { name: 'No course' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(store.updateMaterialFile).toHaveBeenCalledWith('x', { name: 'New name', description: '', courseId: undefined });
    expect(router.back).toHaveBeenCalled();
  });

  it('a failed save keeps the entries and shows the error', async () => {
    params.id = 'x';
    setStore(
      fakeStore('M', {
        materialFiles: [item],
        updateMaterialFile: jest.fn().mockRejectedValue(new Error('You can no longer edit this file.')),
      }),
    );
    await render(<EditMaterialFileScreen />);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Kept');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('You can no longer edit this file.')).toBeTruthy();
    expect(screen.getByLabelText('Name').props.value).toBe('Kept');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('someone else cannot open the edit form', async () => {
    params.id = 'x';
    setStore(fakeStore('N', { materialFiles: [item] }));
    await render(<EditMaterialFileScreen />);
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByText('Only the author can edit this file.')).toBeTruthy();
  });
});
