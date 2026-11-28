// ARU-191: up to 10 photos per homework. The Send homework form (AC 1–3: pick several at once up to the number still
// free, thumbnails with ✕, the 10-photo limit), Homework details (AC 6: every photo in order, one failure on its own,
// AC 8: an old one-photo homework), the card's count (AC 7) and the photo counts of the warning banner, the ZIP entries
// and the phone reminder (AC 9, AC 10).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImageManipulatorModule from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import HomeworkScreen from '@/app/(tabs)/homework';
import HomeworkDetailScreen from '@/app/homework/[id]';
import NewHomeworkScreen from '@/app/homework/new';
import { translate } from '@/i18n';
import { PHOTO_PREPARE_ERROR } from '@/lib/compressPhoto';
import { homeworkPhotos } from '@/lib/photo';
import { deletionWarning, storedOwnPhotos, storedPhotoCount, zipEntries } from '@/lib/photoRetention';
import { remindersFor } from '@/lib/reminders';
import { formatDate } from '@/lib/theme';
import type { Homework, HomeworkAssignment } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
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

const members = [member('A', 'S1')];
const assignment: HomeworkAssignment = {
  id: 'a1',
  courseId: 'A',
  meetingId: 'C1',
  title: 'Fractions',
  description: '',
  createdById: 'M',
  createdAt: '2026-10-20T10:00:00.000Z',
};

/** The picker returns these photos (named p<from>…p<from + n - 1>) once; each prepares to file:///cache/p<i>.jpg. */
function pickMany(n: number, from = 1) {
  const assets = Array.from({ length: n }, (_, i) => {
    const uri = `file:///p${from + i}.jpg`;
    manipulator.__setImage(uri, { width: 4000, height: 3000, out: `file:///cache/p${from + i}.jpg` });
    return { uri, width: 4000, height: 3000 };
  });
  picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets } as never);
}

const thumbs = () => screen.queryAllByTestId('homework-photo-preview').map((t) => (t.props.source as { uri: string }).uri);
const attach = () => screen.getByRole('button', { name: /^(Attach photos|Add photos)$/ });
const LIMIT = 'You can attach up to 10 photos.';

function openForm() {
  params.assignmentId = 'a1';
  const store = fakeStore('S1', { courseMembers: members, assignments: [assignment] });
  setStore(store);
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  manipulator.__reset();
});

describe('Send homework form', () => {
  it('AC 1 / AC 3: picks 3 at once (limit 10), shows 3 thumbnails in order and sends them in that order', async () => {
    const store = openForm();
    pickMany(3);
    await render(<NewHomeworkScreen />);
    expect(screen.getByText('Photos (optional)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Attach photos' }));
    await waitFor(() => expect(thumbs()).toEqual(['file:///cache/p1.jpg', 'file:///cache/p2.jpg', 'file:///cache/p3.jpg']));
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 10, orderedSelection: true, quality: 1 }),
    );
    expect(screen.getByRole('button', { name: 'Add photos' })).toBeEnabled();
    expect(screen.queryByText(LIMIT)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    expect(store.addHomework).toHaveBeenCalledWith(
      expect.objectContaining({ photoUris: ['file:///cache/p1.jpg', 'file:///cache/p2.jpg', 'file:///cache/p3.jpg'] }),
    );
  });

  it('AC 1: with 4 attached the picker offers 6', async () => {
    openForm();
    pickMany(4);
    pickMany(1, 5);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toHaveLength(4));
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toHaveLength(5));
    expect(picker.launchImageLibraryAsync).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 6 }));
  });

  it('AC 3: removing the middle photo keeps the others in order', async () => {
    openForm();
    pickMany(3);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toHaveLength(3));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove photo 2' }));
    expect(thumbs()).toEqual(['file:///cache/p1.jpg', 'file:///cache/p3.jpg']);
    expect(screen.getByLabelText('Attached photo 2')).toBeTruthy();
  });

  it('AC 3: removing the last photo brings back Attach photos', async () => {
    openForm();
    pickMany(1);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(thumbs()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Attach photos' })).toBeTruthy();
  });

  it('AC 2: picking 12 with none attached keeps the first 10, disables the button and shows the message', async () => {
    const store = openForm();
    pickMany(12);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toHaveLength(10));
    expect(thumbs()[9]).toBe('file:///cache/p10.jpg');
    expect(screen.getByRole('button', { name: 'Add photos' })).toBeDisabled();
    expect(screen.getByText(LIMIT)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    expect((store.addHomework as jest.Mock).mock.calls[0][0].photoUris).toHaveLength(10);
  });

  it('AC 2: with 8 attached, picking 5 adds 2 and shows the message', async () => {
    openForm();
    pickMany(8);
    pickMany(5, 9);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toHaveLength(8));
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toHaveLength(10));
    expect(thumbs().slice(8)).toEqual(['file:///cache/p9.jpg', 'file:///cache/p10.jpg']);
    expect(screen.getByText(LIMIT)).toBeTruthy();
  });

  it('AC 2: removing one of 10 enables the button again and hides the message', async () => {
    openForm();
    pickMany(10);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toHaveLength(10));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(screen.getByRole('button', { name: 'Add photos' })).toBeEnabled();
    expect(screen.queryByText(LIMIT)).toBeNull();
  });

  it('edge case: a photo that can\'t be prepared is left out with the message; the others are attached', async () => {
    openForm();
    pickMany(3);
    manipulator.__setImage('file:///p2.jpg', { fail: true });
    await render(<NewHomeworkScreen />);
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toEqual(['file:///cache/p1.jpg', 'file:///cache/p3.jpg']));
    expect(screen.getByText(PHOTO_PREPARE_ERROR)).toBeTruthy();
  });

  it('edge case: the same photo picked twice is attached twice', async () => {
    openForm();
    pickMany(1);
    pickMany(1);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    await fireEvent.press(attach());
    await waitFor(() => expect(thumbs()).toEqual(['file:///cache/p1.jpg', 'file:///cache/p1.jpg']));
  });

  it('AC 3: no photos: sends with an empty list', async () => {
    const store = openForm();
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Send to mentor' }));
    expect(store.addHomework).toHaveBeenCalledWith(expect.objectContaining({ photoUris: [] }));
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

describe('Homework details (AC 6, AC 8)', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees every photo in order', async (who) => {
    params.id = 'h3';
    setStore(fakeStore(who, { courseMembers: members, visibleHomework: [three] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getAllByTestId('homework-photo').map((i) => (i.props.source as { uri: string }).uri)).toEqual([
      'https://signed/1',
      'https://signed/2',
      'https://signed/3',
    ]);
    expect(screen.getByRole('imagebutton', { name: 'Open photo 3' })).toBeTruthy();
  });

  it('a photo that fails to load shows "Photo unavailable" on its own; the others still show', async () => {
    params.id = 'h3';
    const getPhotoUrl = jest.fn(async () => {
      throw new Error('gone');
    });
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [three], getPhotoUrl }));
    await render(<HomeworkDetailScreen />);
    await act(async () => {
      screen.getAllByTestId('homework-photo')[1].props.onError();
    });
    await waitFor(() => expect(screen.getAllByTestId('homework-photo-unavailable')).toHaveLength(1));
    expect(screen.getAllByTestId('homework-photo')).toHaveLength(2);
    expect(getPhotoUrl).toHaveBeenCalledWith('S1/h3/2.jpg');
  });

  it('tapping a photo opens the preview of that photo', async () => {
    params.id = 'h3';
    const store = fakeStore('S1', { courseMembers: members, visibleHomework: [three] });
    setStore(store);
    await render(<HomeworkDetailScreen />);
    await fireEvent.press(screen.getByRole('imagebutton', { name: 'Open photo 2' }));
    expect(screen.getByTestId('photo-preview')).toBeTruthy();
    expect(store.getPhotoUrl).toHaveBeenCalledWith('S1/h3/2.jpg');
  });

  it('AC 8: an old homework with one photo (photoPath only) shows that one photo', async () => {
    params.id = 'old';
    const old = hw({ id: 'old', courseId: 'A', photoPath: 'S1/old.jpg', photoUrl: 'https://signed/old' });
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [old] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getAllByTestId('homework-photo')).toHaveLength(1);
    expect(screen.getByRole('imagebutton', { name: 'Open photo' })).toBeTruthy();
  });

  it('AC 9: removed photos show the note once and no thumbnails', async () => {
    params.id = 'gone';
    const gone = hw({ id: 'gone', courseId: 'A', status: 'checked', photos: [], photoRemovedAt: '2027-05-01T03:17:00Z' });
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [gone] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getAllByTestId('homework-photo-removed')).toHaveLength(1);
    expect(screen.queryByTestId('homework-photo')).toBeNull();
  });
});

describe('Homework card (AC 7)', () => {
  const date = formatDate('2026-10-10T10:00:00.000Z');
  it('a homework with 3 photos says "📎 3 photos"', async () => {
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [three] }));
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByText('Waiting (1)'));
    expect(screen.getByText(`${date} · 📎 3 photos`)).toBeTruthy();
  });

  it('only stored photos count', async () => {
    const partly = { ...three, photos: [three.photos![0], { path: 'S1/h3/2.jpg' }] };
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: [partly] }));
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByText('Waiting (1)'));
    expect(screen.getByText(`${date} · 📎 photo`)).toBeTruthy();
  });

  it.each<[number, string, 'en' | 'ru']>([
    [2, '📎 2 фото', 'ru'],
    [5, '📎 5 фото', 'ru'],
    [10, '📎 10 фото', 'ru'],
    [3, '📎 3 photos', 'en'],
  ])('the count text for %i: %s', (count, text, lang) => {
    expect(translate(lang, 'homework.cardPhotoCount', { count })).toBe(text);
  });
});

describe('Counts (AC 9, AC 10)', () => {
  const checked = (id: string, n: number, over: Partial<Homework> = {}): Homework =>
    hw({
      id,
      courseId: 'A',
      status: 'checked',
      checkedAt: '2026-05-10T10:00:00Z',
      photos: Array.from({ length: n }, (_, i) => ({ path: `S1/${id}/${i + 1}.jpg`, url: `https://signed/${id}/${i}` })),
      ...over,
    });

  it('the stored-photo count and the warning banner count photos, not homework', () => {
    const list = [checked('a', 3), checked('b', 2)];
    expect(storedPhotoCount(storedOwnPhotos(list, 'S1'))).toBe(5);
    expect(deletionWarning(list, 'S1', '2026-01-01', new Date('2026-11-01T10:00:00Z'))).toEqual({ count: 5, date: '2026-11-10' });
  });

  it('AC 10: each photo counts toward the 50 per ZIP', () => {
    const list = Array.from({ length: 6 }, (_, i) => checked(`h${i}`, 9)); // 54 photos in course A
    const entries = zipEntries(list, () => 'Algebra');
    expect(entries.map((e) => [e.part, e.count])).toEqual([
      [1, 50],
      [2, 4],
    ]);
  });

  it('the phone reminder counts photos', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    const reminders = remindersFor({
      userId: 'S1',
      role: 'student',
      settings: {},
      courses: [],
      courseMembers: [],
      meetings: [],
      assignments: [],
      now,
      lang: 'en',
      homework: [checked('a', 3)],
      photoDeletionStart: '2026-01-01',
    });
    const photo = reminders.filter((r) => r.id.includes(':photos:'));
    expect(photo.length).toBeGreaterThan(0);
    expect(photo.every((r) => r.body.startsWith('3 homework photos'))).toBe(true);
  });

  it('AC 8: homeworkPhotos reads an old one-photo homework as 1 photo', () => {
    expect(homeworkPhotos(hw({ id: 'x', photoPath: 'S1/x.jpg' }))).toEqual([{ path: 'S1/x.jpg', url: undefined }]);
    expect(homeworkPhotos(hw({ id: 'y' }))).toEqual([]);
  });
});
