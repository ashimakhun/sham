// ARU-18 QA additions to aru18-photo-preview.test.tsx, following the TEST DESIGN: Esc on web (AC 3), a failed
// download (AC 8), the display link missing or expired while the photo still exists (AC 7), a mentor previewing
// their own homework (access + still no "Mark as checked"), and Download available for every role (AC 4).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';

import HomeworkDetailScreen from '@/app/homework/[id]';
import { PHOTO_ERROR } from '@/lib/photo';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const originalOS = Platform.OS;
const setOS = (os: typeof Platform.OS) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const photo = hw({
  id: 'abcd1234-0000-4000-8000-000000000009',
  courseId: 'A',
  title: 'Long screenshot',
  photoPath: 'S1/abcd1234.jpg',
  photoUrl: 'https://old.example/display',
});
const members = [member('A', 'S1'), member('A', 'N')];

const openPreview = async () => {
  await fireEvent.press(screen.getByRole('imagebutton', { name: 'Open photo' }));
  return screen.getByTestId('photo-preview');
};
const loadImage = async () => {
  const img = await screen.findByTestId('photo-preview-image');
  await act(async () => img.props.onLoad?.());
};

beforeEach(() => {
  jest.clearAllMocks();
  params.id = photo.id;
});
afterEach(() => {
  setOS(originalOS);
  delete (globalThis as { document?: unknown }).document;
});

// The native jest environment has no DOM: a minimal document that records key listeners, like a browser would.
const fakeDocument = () => {
  const listeners = new Set<(e: { key: string }) => void>();
  (globalThis as { document?: unknown }).document = {
    addEventListener: (_type: string, fn: (e: { key: string }) => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: (e: { key: string }) => void) => listeners.delete(fn),
  };
  return {
    press: (key: string) => act(async () => listeners.forEach((fn) => fn({ key }))),
    count: () => listeners.size,
  };
};

it('AC3 (web): Esc closes the preview and keeps the typed comment', async () => {
  setOS('web');
  const doc = fakeDocument();
  setStore(fakeStore('M', { courseMembers: members, visibleHomework: [photo] }));
  await render(<HomeworkDetailScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('What was good? What to improve?'), 'Nice work');
  await openPreview();
  await doc.press('Escape');
  expect(screen.queryByTestId('photo-preview')).toBeNull();
  expect(screen.getByDisplayValue('Nice work')).toBeTruthy();
  // The key listener is removed with the preview (no leak, Esc no longer does anything).
  expect(doc.count()).toBe(0);
});

it('AC3 (web): other keys do not close the preview', async () => {
  setOS('web');
  const doc = fakeDocument();
  setStore(fakeStore('M', { courseMembers: members, visibleHomework: [photo] }));
  await render(<HomeworkDetailScreen />);
  await openPreview();
  await doc.press('Enter');
  expect(screen.getByTestId('photo-preview')).toBeTruthy();
});

it('AC8: a failed download link shows the error, opens nothing, and the preview still closes', async () => {
  const getPhotoUrl = jest.fn(async (path: string, opts?: { download?: string }) => {
    if (opts?.download) throw new Error('Failed to fetch');
    return `https://signed.example/${path}`;
  });
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  setStore(fakeStore('T', { courseMembers: members, visibleHomework: [photo], getPhotoUrl }));
  await render(<HomeworkDetailScreen />);
  await openPreview();
  await loadImage();
  await fireEvent.press(screen.getByRole('button', { name: 'Download' }));
  expect(await screen.findByText(PHOTO_ERROR)).toBeTruthy();
  expect(openURL).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByTestId('photo-preview')).toBeNull();
});

it('AC8: the device refusing to open the link shows the error instead of crashing', async () => {
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No app can open this URL'));
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [photo] }));
  await render(<HomeworkDetailScreen />);
  await openPreview();
  await loadImage();
  await fireEvent.press(screen.getByRole('button', { name: 'Download' }));
  expect(await screen.findByText(PHOTO_ERROR)).toBeTruthy();
  // Download is usable again after the failure (not stuck on "Preparing…").
  expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
});

it('AC7: the display link could not be made (no photoUrl), but the photo exists → still tappable, preview loads', async () => {
  const noDisplayUrl = { ...photo, photoUrl: undefined };
  const store = fakeStore('M', { courseMembers: members, visibleHomework: [noDisplayUrl] });
  setStore(store);
  await render(<HomeworkDetailScreen />);
  await openPreview();
  expect(store.getPhotoUrl).toHaveBeenCalledWith('S1/abcd1234.jpg');
  expect((await screen.findByTestId('photo-preview-image')).props.source).toEqual({
    uri: 'https://signed.example/S1/abcd1234.jpg',
  });
});

it.each(['S1', 'M', 'T'] as const)('AC4/AC6: %s (can see the homework) gets the preview with Download', async (who) => {
  setStore(fakeStore(who, { courseMembers: members, visibleHomework: [photo] }));
  await render(<HomeworkDetailScreen />);
  await openPreview();
  expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
});

it('access: a mentor previews and downloads their own homework photo but still cannot check it', async () => {
  const own = { ...photo, studentId: 'N' };
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const store = fakeStore('N', { courseMembers: members, visibleHomework: [own] });
  setStore(store);
  await render(<HomeworkDetailScreen />);
  expect(screen.queryByRole('button', { name: '✓ Mark as checked' })).toBeNull();
  await openPreview();
  await loadImage();
  await fireEvent.press(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(openURL).toHaveBeenCalled());
  expect(store.getPhotoUrl).toHaveBeenLastCalledWith('S1/abcd1234.jpg', {
    expiresIn: 60,
    download: 'Long_screenshot-abcd1234.jpg',
  });
});
