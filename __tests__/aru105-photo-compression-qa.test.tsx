// QA ARU-105: gaps in aru105-photo-compression.test.tsx: while a photo is being prepared the screen says so and
// Send / the other pick buttons are disabled (and enabled again once it ends); the Pay picker asks for the full-quality, compatible (JPEG) asset; a
// PDF proof never goes through the image manipulator; a PNG is saved as JPEG; the result keeps the 1600 px limit
// at the boundaries (1601 px is resized, 1600 px is not).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulatorModule from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import PayScreen from '@/app/courses/[id]/pay';
import NewHomeworkScreen from '@/app/homework/new';
import { preparePhoto } from '@/lib/compressPhoto';
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

const manipulator = ImageManipulatorModule as unknown as typeof ImageManipulatorModule & {
  __setImage: (uri: string, info: object) => void;
  __reset: () => void;
  ImageManipulator: { manipulate: jest.Mock };
};
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const docs = DocumentPicker as jest.Mocked<typeof DocumentPicker>;

const pick = (uri: string) =>
  picker.launchImageLibraryAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri, width: 4000, height: 3000, mimeType: 'image/heic', fileName: 'IMG_9.HEIC', fileSize: 5_000_000 }],
  } as never);
/** The next photo stays in preparation until the returned function is called; then it fails. */
const hang = () => {
  let release = () => {};
  const done = new Promise<never>((_, reject) => {
    release = () => reject(new Error('released'));
  });
  manipulator.ImageManipulator.manipulate.mockImplementationOnce(() => ({ renderAsync: () => done, resize: jest.fn() }));
  return () => release();
};
/** Starts a press without waiting for its handler (which waits for the photo). */
const startPress = (name: string) => {
  const host = screen.getByRole('button', { name }) as unknown as {
    props: { onStartShouldSetResponder: { testOnly_pressabilityConfig: () => { onPress: () => unknown } } };
  };
  return act(async () => {
    void host.props.onStartShouldSetResponder.testOnly_pressabilityConfig().onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  manipulator.__reset();
});

describe('preparePhoto boundaries', () => {
  it.each([
    [1601, 1000, 1600],
    [1000, 1601, 1600],
    [1600, 900, 1600],
  ])('%i×%i → longest side %i', async (w, h, side) => {
    manipulator.__setImage('file:///x', { width: w, height: h, bytes: 1000 });
    const photo = await preparePhoto('file:///x');
    expect(Math.max(photo.width, photo.height)).toBe(side);
  });

  it('a PNG is saved as JPEG (the format asked for does not depend on the source)', async () => {
    manipulator.__setImage('file:///shot.png', { width: 1170, height: 2532, bytes: 200_000 });
    await preparePhoto('file:///shot.png');
    const context = manipulator.ImageManipulator.manipulate.mock.results[0].value;
    const ref = await context.renderAsync.mock.results.at(-1).value;
    expect(ref.saveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg' }));
  });
});

describe('Add homework while preparing', () => {
  const assignment: HomeworkAssignment = {
    id: 'a1',
    courseId: 'A',
    meetingId: 'C1',
    title: 'Fractions',
    description: '',
    createdById: 'M',
    createdAt: '2026-10-20T10:00:00.000Z',
  };

  it('shows "Preparing photo…" and Send stays disabled, even with text typed', async () => {
    params.assignmentId = 'a1';
    const store = fakeStore('S1', { courseMembers: [member('A', 'S1')], assignments: [assignment] });
    setStore(store);
    pick('file:///slow.heic');
    const release = hang();
    await render(<NewHomeworkScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('What did you do? Any questions for your mentor?'), 'Done');
    await startPress('Attach a photo');
    expect(screen.getByRole('button', { name: 'Preparing photo…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send to mentor' })).toBeDisabled();
    expect(store.addHomework).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Attach a photo' })).toBeEnabled());
  });
});

describe('Pay screen', () => {
  const billing: CourseBilling = { courseId: 'A', startDay: 1, endDay: 28, selectedById: 'N', selectedAt: '2026-11-01T10:00:00.000Z' };
  const open = () => {
    params.id = 'A';
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], courseBilling: [billing] }));
  };

  it('asks the picker for the full-quality, compatible asset', async () => {
    open();
    manipulator.__setImage('file:///p.heic', { width: 4000, height: 3000, bytes: 300_000 });
    pick('file:///p.heic');
    await render(<PayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a photo' }));
    await screen.findByTestId('proof-thumbnail');
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], quality: 1, preferredAssetRepresentationMode: 'compatible' }),
    );
  });

  it('while a photo is preparing, both pick buttons and Send are disabled', async () => {
    open();
    pick('file:///slow.heic');
    const release = hang();
    await render(<PayScreen />);
    await startPress('Attach a photo');
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Attach a PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Attach a PDF' })).toBeEnabled());
  });

  it('a PDF proof is attached as is, without the image manipulator', async () => {
    open();
    docs.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///bill.pdf', name: 'bill.pdf', mimeType: 'application/pdf', size: 900_000 }],
    } as never);
    await render(<PayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a PDF' }));
    expect(await screen.findByText('bill.pdf')).toBeTruthy();
    expect(manipulator.ImageManipulator.manipulate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
  });
});
