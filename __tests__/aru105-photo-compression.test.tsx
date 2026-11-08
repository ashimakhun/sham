// ARU-105: homework and payment-proof photos are resized (1600 px on the longest side) and compressed to JPEG when
// they are picked. expo-image-manipulator is the stand-in from jest.setup.js (__setImage describes a picked photo).
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImageManipulatorModule from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import PayScreen from '@/app/courses/[id]/pay';
import NewHomeworkScreen from '@/app/homework/new';
import { localMonth } from '@/lib/billing';
import {
  base64Bytes,
  PHOTO_MAX_SIDE,
  PHOTO_PREPARE_ERROR,
  PHOTO_QUALITY,
  preparePhoto,
  resizeFor,
} from '@/lib/compressPhoto';
import type { CourseBilling, HomeworkAssignment } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

type Fake = { width?: number; height?: number; bytes?: number; out?: string; fail?: boolean | 'render' | 'save' };
const manipulator = ImageManipulatorModule as unknown as typeof ImageManipulatorModule & {
  __setImage: (uri: string, info: Fake) => void;
  __reset: () => void;
  ImageManipulator: { manipulate: jest.Mock };
};
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const MB = 1024 * 1024;

/** The picker returns this photo once. */
function pick(uri: string, over: Partial<ImagePicker.ImagePickerAsset> = {}) {
  picker.launchImageLibraryAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri, width: 4000, height: 3000, mimeType: 'image/heic', fileName: 'IMG_1.HEIC', fileSize: 4 * MB, ...over }],
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  manipulator.__reset();
});

describe('resizeFor / base64Bytes', () => {
  it.each([
    [4000, 3000, { width: 1600 }],
    [3000, 4000, { height: 1600 }],
    [6000, 1000, { width: 1600 }],
    [1000, 6000, { height: 1600 }],
    [2000, 2000, { width: 1600 }],
  ])('%i×%i over the limit → %j', (w, h, expected) => {
    expect(resizeFor(w, h)).toEqual(expected);
  });

  it.each([
    [800, 600],
    [1600, 1200],
    [1200, 1600],
    [1600, 1600],
  ])('%i×%i is never enlarged or resized', (w, h) => {
    expect(resizeFor(w, h)).toBeNull();
  });

  it('counts the bytes a base64 string encodes, with or without padding or a data: prefix', () => {
    expect(base64Bytes('AAAA')).toBe(3);
    expect(base64Bytes('AAA=')).toBe(2);
    expect(base64Bytes('AA==')).toBe(1);
    expect(base64Bytes('data:image/jpeg;base64,AAAAAAAA')).toBe(6);
    expect(base64Bytes('')).toBe(0);
  });
});

describe('preparePhoto (AC 1, AC 2, AC 6)', () => {
  it.each([
    [4000, 3000, 1600, 1200],
    [3000, 4000, 1200, 1600],
    [6000, 1000, 1600, 267],
  ])('%i×%i becomes %i×%i, saved as JPEG at 75%%', async (w, h, ow, oh) => {
    manipulator.__setImage('file:///big.heic', { width: w, height: h, bytes: 300_000, out: 'file:///cache/a.jpg' });
    const photo = await preparePhoto('file:///big.heic');
    expect(photo).toMatchObject({ uri: 'file:///cache/a.jpg', width: ow, height: oh, size: 300_000 });
    expect(Math.max(photo.width, photo.height)).toBe(PHOTO_MAX_SIDE);
    const context = manipulator.ImageManipulator.manipulate.mock.results[0].value;
    const ref = await context.renderAsync.mock.results.at(-1).value;
    expect(ref.saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: PHOTO_QUALITY, base64: true });
  });

  it('a small photo is re-encoded as JPEG but not resized', async () => {
    manipulator.__setImage('file:///small.png', { width: 800, height: 600, bytes: 90_000 });
    const photo = await preparePhoto('file:///small.png');
    expect(photo).toMatchObject({ width: 800, height: 600 });
    const context = manipulator.ImageManipulator.manipulate.mock.results[0].value;
    expect(context.resize).not.toHaveBeenCalled();
  });

  it.each([true, 'save'] as const)('a photo that can\'t be read or saved (%s) throws the AC 6 message', async (fail) => {
    manipulator.__setImage('file:///broken.jpg', { width: 4000, height: 3000, fail });
    await expect(preparePhoto('file:///broken.jpg')).rejects.toThrow(PHOTO_PREPARE_ERROR);
  });

  it('an empty result is treated as a failure', async () => {
    manipulator.__setImage('file:///empty.jpg', { width: 10, height: 10, bytes: 0 });
    await expect(preparePhoto('file:///empty.jpg')).rejects.toThrow(PHOTO_PREPARE_ERROR);
  });
});

describe('Add homework (AC 1–3, AC 6)', () => {
  const assignment: HomeworkAssignment = {
    id: 'a1',
    courseId: 'A',
    meetingId: 'C1',
    title: 'Fractions',
    description: '',
    createdById: 'M',
    createdAt: '2026-10-20T10:00:00.000Z',
  };
  const open = (over = {}) => {
    params.assignmentId = 'a1';
    const store = fakeStore('S1', { courseMembers: [member('A', 'S1')], assignments: [assignment], ...over });
    setStore(store);
    return store;
  };
  const preview = () => screen.queryAllByTestId('homework-photo-preview');

  it('the picked photo is prepared at once; the preview and the send use the prepared file', async () => {
    const store = open();
    manipulator.__setImage('file:///IMG_1.HEIC', { width: 4000, height: 3000, bytes: 280_000, out: 'file:///cache/hw.jpg' });
    pick('file:///IMG_1.HEIC');
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    await waitFor(() => expect(preview()[0]?.props.source).toEqual({ uri: 'file:///cache/hw.jpg' }));
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], quality: 1, preferredAssetRepresentationMode: 'compatible' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    expect(store.addHomework).toHaveBeenCalledWith(expect.objectContaining({ photoUri: 'file:///cache/hw.jpg' }));
  });

  it('Change photo replaces the preview with the newly prepared photo', async () => {
    open();
    manipulator.__setImage('file:///one.jpg', { width: 4000, height: 3000, out: 'file:///cache/one.jpg' });
    manipulator.__setImage('file:///two.jpg', { width: 4000, height: 3000, out: 'file:///cache/two.jpg' });
    pick('file:///one.jpg');
    pick('file:///two.jpg');
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Change photo' }));
    await waitFor(() => expect(preview()[0]?.props.source).toEqual({ uri: 'file:///cache/two.jpg' }));
  });

  it('AC 6: a photo that can\'t be prepared shows the message; the text and the earlier photo stay', async () => {
    const store = open();
    manipulator.__setImage('file:///good.jpg', { width: 4000, height: 3000, out: 'file:///cache/good.jpg' });
    manipulator.__setImage('file:///bad.jpg', { fail: true });
    pick('file:///good.jpg');
    pick('file:///bad.jpg');
    await render(<NewHomeworkScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('What did you do? Any questions for your mentor?'), 'Done all');
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Change photo' }));
    expect(await screen.findByText(PHOTO_PREPARE_ERROR)).toBeTruthy();
    expect(preview()[0]?.props.source).toEqual({ uri: 'file:///cache/good.jpg' });
    expect(screen.getByPlaceholderText('What did you do? Any questions for your mentor?').props.value).toBe('Done all');
    expect(store.addHomework).not.toHaveBeenCalled();
  });

  it('AC 6: with no earlier photo nothing is attached', async () => {
    open();
    manipulator.__setImage('file:///bad.jpg', { fail: true });
    pick('file:///bad.jpg');
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    expect(await screen.findByText(PHOTO_PREPARE_ERROR)).toBeTruthy();
    expect(preview()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Attach a photo' })).toBeTruthy();
  });

  it('a cancelled pick changes nothing', async () => {
    open();
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null } as never);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    expect(manipulator.ImageManipulator.manipulate).not.toHaveBeenCalled();
    expect(preview()).toHaveLength(0);
  });
});

describe('Pay screen (AC 5, AC 6)', () => {
  const billing: CourseBilling = { courseId: 'A', startDay: 1, endDay: 28, selectedById: 'N', selectedAt: '2026-11-01T10:00:00.000Z' };
  const open = (over = {}) => {
    params.id = 'A';
    const store = fakeStore('S1', { courseMembers: [member('A', 'S1')], courseBilling: [billing], ...over });
    setStore(store);
    return store;
  };

  it('a 12 MB original is accepted once compressed; the thumbnail and the request use the compressed JPEG', async () => {
    const store = open();
    manipulator.__setImage('file:///huge.heic', { width: 4000, height: 3000, bytes: 350_001, out: 'file:///cache/proof.jpg' });
    pick('file:///huge.heic', { fileSize: 12 * MB });
    await render(<PayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    expect((await screen.findByTestId('proof-thumbnail')).props.source).toEqual({ uri: 'file:///cache/proof.jpg' });
    expect(screen.queryByText('The proof must be a photo or a PDF up to 10 MB.')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(store.sendPaymentRequest).toHaveBeenCalledWith(
        'A',
        localMonth(),
        expect.objectContaining({ uri: 'file:///cache/proof.jpg', kind: 'image', mimeType: 'image/jpeg', size: 350_001 }),
      ),
    );
  });

  it('a photo still over 10 MB after compression shows the proof rule and nothing is attached', async () => {
    open();
    manipulator.__setImage('file:///giant.jpg', { width: 1000, height: 1000, bytes: 10 * MB + 3 });
    pick('file:///giant.jpg');
    await render(<PayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    expect(await screen.findByText('The proof must be a photo or a PDF up to 10 MB.')).toBeTruthy();
    expect(screen.queryByTestId('proof-preview')).toBeNull();
  });

  it('AC 6: a photo that can\'t be prepared shows the message and keeps the proof attached earlier', async () => {
    open();
    manipulator.__setImage('file:///ok.jpg', { width: 2000, height: 1500, out: 'file:///cache/ok.jpg' });
    manipulator.__setImage('file:///bad.jpg', { fail: true });
    pick('file:///ok.jpg');
    pick('file:///bad.jpg');
    await render(<PayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Replace photo' }));
    expect(await screen.findByText(PHOTO_PREPARE_ERROR)).toBeTruthy();
    expect(screen.getByTestId('proof-thumbnail').props.source).toEqual({ uri: 'file:///cache/ok.jpg' });
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
  });
});
