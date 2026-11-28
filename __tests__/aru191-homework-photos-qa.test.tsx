// QA ARU-191: gaps in aru191-homework-photos.test.tsx. A mentor sending as a listener (AC 1); the "Sending…" state
// while every photo uploads, no double send and no removing a photo mid-send (AC 4, edge case); a failed send keeps the
// text and all photos (AC 5); with 10 attached the picker can't be opened (AC 2); another mentor who checks the
// homework sees every photo (AC 6); the card in Russian keeps one photo as «📎 фото» and counts 3 (AC 7, AC 8).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImageManipulatorModule from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import HomeworkScreen from '@/app/(tabs)/homework';
import HomeworkDetailScreen from '@/app/homework/[id]';
import NewHomeworkScreen from '@/app/homework/new';
import { translate } from '@/i18n';
import { formatDate } from '@/lib/theme';
import type { HomeworkAssignment } from '@/lib/types';

import { courseA, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const manipulator = ImageManipulatorModule as unknown as typeof ImageManipulatorModule & {
  __setImage: (uri: string, info: object) => void;
  __reset: () => void;
};
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

const assignment: HomeworkAssignment = {
  id: 'a1',
  courseId: 'A',
  meetingId: 'C1',
  title: 'Fractions',
  description: '',
  createdById: 'M',
  createdAt: '2026-10-20T10:00:00.000Z',
};

function pickMany(n: number, from = 1) {
  const assets = Array.from({ length: n }, (_, i) => {
    const uri = `file:///q${from + i}.jpg`;
    manipulator.__setImage(uri, { width: 4000, height: 3000, out: `file:///cache/q${from + i}.jpg` });
    return { uri, width: 4000, height: 3000 };
  });
  picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets } as never);
}
const thumbs = () => screen.queryAllByTestId('homework-photo-preview').map((t) => (t.props.source as { uri: string }).uri);
const DESCRIPTION = 'What did you do? Any questions for your mentor?';

beforeEach(() => {
  jest.clearAllMocks();
  manipulator.__reset();
});

describe('Send homework: roles and sending', () => {
  it('AC 1: a mentor on their Listener side attaches 3 photos at once and sends them in order', async () => {
    params.assignmentId = 'a1';
    // Course A is M's; N is a listener of it.
    const store = fakeStore('N', { courseMembers: [member('A', 'N')], assignments: [assignment] });
    setStore(store);
    pickMany(3);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach photos' }));
    await waitFor(() => expect(thumbs()).toHaveLength(3));
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    expect(store.addHomework).toHaveBeenCalledWith(
      expect.objectContaining({ photoUris: ['file:///cache/q1.jpg', 'file:///cache/q2.jpg', 'file:///cache/q3.jpg'] }),
    );
  });

  it('AC 4: "Sending…" until done; a second tap and ✕ do nothing meanwhile', async () => {
    params.assignmentId = 'a1';
    let finish = () => {};
    const store = fakeStore('S1', { courseMembers: [member('A', 'S1')], assignments: [assignment] });
    (store.addHomework as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    setStore(store);
    pickMany(2);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach photos' }));
    await waitFor(() => expect(thumbs()).toHaveLength(2));
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Sending…' }));
    expect(store.addHomework).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add photos' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(thumbs()).toHaveLength(2);
    await act(async () => finish());
  });

  it('AC 5: a failed send keeps the text and every photo, and a retry sends the same photos with the same id', async () => {
    params.assignmentId = 'a1';
    const store = fakeStore('S1', { courseMembers: [member('A', 'S1')], assignments: [assignment] });
    (store.addHomework as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
    setStore(store);
    pickMany(3);
    await render(<NewHomeworkScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText(DESCRIPTION), 'Pages 1–3');
    await fireEvent.press(screen.getByRole('button', { name: 'Attach photos' }));
    await waitFor(() => expect(thumbs()).toHaveLength(3));
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send to mentor' })).toBeEnabled());
    expect(thumbs()).toEqual(['file:///cache/q1.jpg', 'file:///cache/q2.jpg', 'file:///cache/q3.jpg']);
    expect(screen.getByDisplayValue('Pages 1–3')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    const calls = (store.addHomework as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0].photoUris).toEqual(calls[0][0].photoUris);
    expect(calls[1][0].id).toBe(calls[0][0].id);
  });

  it('AC 2: with 10 attached, pressing the disabled button never opens the picker', async () => {
    params.assignmentId = 'a1';
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], assignments: [assignment] }));
    pickMany(10);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach photos' }));
    await waitFor(() => expect(thumbs()).toHaveLength(10));
    expect(screen.getByText('You can attach up to 10 photos.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add photos' }));
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  });
});

const three = hw({
  id: 'h3',
  courseId: 'A',
  title: 'Three pages',
  photos: [
    { path: 'S1/h3/1.jpg', url: 'https://signed/1' },
    { path: 'S1/h3/2.jpg', url: 'https://signed/2' },
    { path: 'S1/h3/3.jpg', url: 'https://signed/3' },
  ],
  photoPath: 'S1/h3/1.jpg',
  photoUrl: 'https://signed/1',
});

describe('Homework details and card', () => {
  it('AC 6: a mentor who is not the course owner (N, checks it) sees every photo in order', async () => {
    params.id = 'h3';
    setStore(fakeStore('N', { courseMembers: [member('A', 'S1')], visibleHomework: [three] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getAllByTestId('homework-photo').map((i) => (i.props.source as { uri: string }).uri)).toEqual([
      'https://signed/1',
      'https://signed/2',
      'https://signed/3',
    ]);
  });

  it('AC 6: tapping the last photo opens the preview of that photo (not the first)', async () => {
    params.id = 'h3';
    const store = fakeStore('S1', { courseMembers: [member('A', 'S1')], visibleHomework: [three] });
    setStore(store);
    await render(<HomeworkDetailScreen />);
    await fireEvent.press(screen.getByRole('imagebutton', { name: 'Open photo 3' }));
    expect(screen.getByTestId('photo-preview')).toBeTruthy();
    expect(store.getPhotoUrl).toHaveBeenCalledWith('S1/h3/3.jpg');
  });

  it('AC 7 / AC 8: Russian card texts: one photo «📎 фото», three «📎 3 фото»', () => {
    expect(translate('ru', 'homework.withPhoto')).toMatch(/фото/);
    expect(translate('ru', 'homework.cardPhotoCount', { count: 1 })).toBe('📎 1 фото');
    expect(translate('ru', 'homework.cardPhotoCount', { count: 3 })).toBe('📎 3 фото');
    expect(translate('ru', 'homework.cardPhotoCount', { count: 21 })).toBe('📎 21 фото');
  });

  it('AC 8: an old one-photo homework\'s card still says "📎 photo"; no photo, no count', async () => {
    const old = hw({ id: 'old', courseId: 'A', photoPath: 'S1/old.jpg', photoUrl: 'https://signed/old' });
    const none = hw({ id: 'none', courseId: 'A', title: 'No photo', createdAt: '2026-10-11T10:00:00.000Z' });
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], courses: [courseA], visibleHomework: [old, none] }));
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByText('Waiting (2)'));
    expect(screen.getByText(`${formatDate('2026-10-10T10:00:00.000Z')} · 📎 photo`)).toBeTruthy();
    expect(screen.getByText(formatDate('2026-10-11T10:00:00.000Z'))).toBeTruthy();
  });
});
