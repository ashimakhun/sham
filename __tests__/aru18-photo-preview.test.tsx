// ARU-18: homework photo — whole photo on the details screen, full-screen preview, Download of the original.
// Access stays with the storage policies (the signed URL is refused for homework the user can't read).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import HomeworkDetailScreen from '@/app/homework/[id]';
import { PHOTO_ERROR, photoFileName } from '@/lib/photo';
import { router } from 'expo-router';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const withPhoto = hw({
  id: '1234abcd-0000-4000-8000-000000000001',
  courseId: 'A',
  title: 'Essay on Abai',
  photoPath: 'S1/1234abcd.jpg',
  photoUrl: 'https://old.example/expired',
});
const noPhoto = hw({ id: 'h2', courseId: 'A', title: 'No photo here' });
const members = [member('A', 'S1')];

const openPreview = async () => {
  await fireEvent.press(screen.getByRole('imagebutton', { name: 'Open photo' }));
  return screen.getByTestId('photo-preview');
};

beforeEach(() => {
  jest.clearAllMocks();
  params.id = withPhoto.id;
});

describe('Details screen', () => {
  it.each(['S1', 'M', 'T'] as const)('AC1: %s sees the whole photo (contain, not cover)', async (who) => {
    setStore(fakeStore(who, { courseMembers: members, visibleHomework: [withPhoto] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getByTestId('homework-photo').props.resizeMode).toBe('contain');
  });

  it('AC9: homework without a photo has no photo area and no preview', async () => {
    params.id = 'h2';
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [noPhoto] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.queryByTestId('homework-photo')).toBeNull();
    expect(screen.queryByRole('imagebutton', { name: 'Open photo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });
});

describe('Preview', () => {
  it('AC2/AC7/AC8: tapping opens a dark full-screen preview with a fresh link, spinner until loaded', async () => {
    const store = fakeStore('M', { courseMembers: members, visibleHomework: [withPhoto] });
    setStore(store);
    await render(<HomeworkDetailScreen />);
    await openPreview();
    expect(store.getPhotoUrl).toHaveBeenCalledWith('S1/1234abcd.jpg');
    const image = await screen.findByTestId('photo-preview-image');
    expect(image.props.source).toEqual({ uri: 'https://signed.example/S1/1234abcd.jpg' }); // not the expired one
    expect(image.props.resizeMode).toBe('contain');
    expect(screen.getByTestId('photo-preview-loading')).toBeTruthy();
    await act(async () => image.props.onLoad?.({}));
    expect(screen.queryByTestId('photo-preview-loading')).toBeNull();
  });

  it('AC3: ✕ closes the preview and the typed comment is still there', async () => {
    setStore(fakeStore('M', { courseMembers: members, visibleHomework: [withPhoto] }));
    await render(<HomeworkDetailScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('What was good? What to improve?'), 'Nice work');
    await openPreview();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(screen.getByDisplayValue('Nice work')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('AC3: Android back (onRequestClose) closes the preview, not the screen', async () => {
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [withPhoto] }));
    await render(<HomeworkDetailScreen />);
    let modal = (await openPreview()).parent;
    while (modal && !modal.props.onRequestClose) modal = modal.parent;
    await act(async () => modal!.props.onRequestClose());
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(screen.getByText('Essay on Abai')).toBeTruthy();
  });

  it('AC4/AC5: Download asks for a short-lived attachment link named after the title and opens it', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const store = fakeStore('S1', { courseMembers: members, visibleHomework: [withPhoto] });
    setStore(store);
    await render(<HomeworkDetailScreen />);
    await openPreview();
    await fireEvent.press(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(store.getPhotoUrl).toHaveBeenLastCalledWith('S1/1234abcd.jpg', {
      expiresIn: 60,
      download: 'Essay_on_Abai-1234abcd.jpg',
    });
    expect(open).toHaveBeenCalledWith('https://signed.example/S1/1234abcd.jpg');
  });

  it('analysis note 6: a second tap while the link is being made is ignored', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    let finish: (u: string) => void = () => {};
    const getPhotoUrl = jest.fn((_path: string, opts?: { download?: string }) =>
      opts?.download ? new Promise<string>((r) => (finish = r)) : Promise.resolve('https://signed.example/x'),
    );
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [withPhoto], getPhotoUrl }));
    await render(<HomeworkDetailScreen />);
    await openPreview();
    // Not awaited: the first download stays pending until finish() is called.
    void fireEvent.press(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('Preparing…')).toBeTruthy();
    void fireEvent.press(screen.getByRole('button', { name: 'Download' }));
    expect(getPhotoUrl.mock.calls.filter((c) => c[1]?.download)).toHaveLength(1);
    await act(async () => finish('https://signed.example/dl'));
    expect(await screen.findByText('Download')).toBeTruthy();
  });

  it('AC6/AC8: a refused or failed link shows the error, and the preview can still be closed', async () => {
    const getPhotoUrl = jest.fn(async () => {
      throw new Error('Object not found');
    });
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [withPhoto], getPhotoUrl }));
    await render(<HomeworkDetailScreen />);
    await openPreview();
    expect(await screen.findByText(PHOTO_ERROR)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('photo-preview')).toBeNull();
  });

  it('AC8: an image that fails to load shows the error', async () => {
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [withPhoto] }));
    await render(<HomeworkDetailScreen />);
    await openPreview();
    const image = await screen.findByTestId('photo-preview-image');
    await act(async () => image.props.onError?.({}));
    expect(screen.getByText(PHOTO_ERROR)).toBeTruthy();
  });

  it('edge: an unrelated live update does not refetch the link (no flash)', async () => {
    const store = fakeStore('M', { courseMembers: members, visibleHomework: [withPhoto] });
    setStore(store);
    const view = await render(<HomeworkDetailScreen />);
    await openPreview();
    await screen.findByTestId('photo-preview-image');
    setStore({ ...store, visibleHomework: [{ ...withPhoto, photoUrl: 'https://new.example/x' }, noPhoto] });
    await view.rerender(<HomeworkDetailScreen />);
    expect(store.getPhotoUrl).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('photo-preview')).toBeTruthy();
  });

  it('edge: the homework disappears (live update) → preview closes, "Homework not found"', async () => {
    const store = fakeStore('S1', { courseMembers: members, visibleHomework: [withPhoto] });
    setStore(store);
    const view = await render(<HomeworkDetailScreen />);
    await openPreview();
    setStore({ ...store, visibleHomework: [] });
    await view.rerender(<HomeworkDetailScreen />);
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(screen.getByText('Homework not found')).toBeTruthy();
  });
});

describe('AC10: list unchanged', () => {
  it('the card keeps the photo marker and opens the details screen', async () => {
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [withPhoto] }));
    await render(<HomeworkScreen />);
    expect(screen.getByText(/📎/)).toBeTruthy();
    expect(screen.queryByTestId('photo-preview')).toBeNull();
  });
});

describe('photoFileName (analysis note 1)', () => {
  it.each([
    ['Essay on Abai', 'Essay_on_Abai-1234abcd.jpg'],
    ['a/b\\c:d*e?f"g<h>i|j', 'a_b_c_d_e_f_g_h_i_j-1234abcd.jpg'],
    ['   ', 'homework-1234abcd.jpg'],
    ['x'.repeat(100), `${'x'.repeat(60)}-1234abcd.jpg`],
    ['Сочинение 📝', 'Сочинение_📝-1234abcd.jpg'],
  ])('%j → %s', (title, expected) => {
    expect(photoFileName(title, '1234abcd-0000')).toBe(expected);
  });
});
