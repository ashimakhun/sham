// ARU-107 (part a): the deletion date, the 30-day warning banner, Download my photos, Download by course and the rule
// text on Add homework. Nothing is deleted (AC 10). Server rules: supabase/tests/aru107_homework_photo_rule.test.sql;
// the ZIP function: supabase/functions/_shared/homework-photos-zip.test.ts.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import NewHomeworkScreen from '@/app/homework/new';
import DownloadByCourseScreen from '@/app/homework/photos';
import {
  addMonths,
  deletionWarning,
  deletionWarningText,
  formatUtcDate,
  PHOTO_RULE,
  photoDeletionDate,
  PHOTOS_ZIP_ERROR,
  storedOwnPhotos,
  zipEntries,
} from '@/lib/photoRetention';
import type { Course, Homework, HomeworkAssignment } from '@/lib/types';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const NOW = new Date('2026-11-08T10:00:00Z');
/** A stored photo of S1's, checked at `checkedAt` (or not checked). */
const photo = (id: string, over: Partial<Homework> = {}): Homework =>
  hw({ id, courseId: 'A', photoPath: `S1/${id}.jpg`, photoUrl: `https://signed/${id}`, ...over });
const checked = (id: string, checkedAt: string, over: Partial<Homework> = {}) =>
  photo(id, { status: 'checked', checkedAt, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('the deletion date (AC 2, AC 3)', () => {
  it.each([
    ['2026-11-12', '2027-05-12'],
    ['2026-08-31', '2027-02-28'],
    ['2027-08-31', '2028-02-29'],
    ['2026-03-31', '2026-09-30'],
    ['2026-12-15', '2027-06-15'],
  ])('%s + 6 months = %s (as Postgres does)', (day, expected) => {
    expect(addMonths(day, 6)).toBe(expected);
  });

  it('uses the UTC day of the check, never earlier than the start date, and nothing while the start date is empty', () => {
    expect(photoDeletionDate('2026-11-12T23:30:00Z', null)).toBeNull();
    expect(photoDeletionDate(undefined, '2026-01-01')).toBeNull();
    expect(photoDeletionDate('2026-11-12T23:30:00Z', '2026-01-01')).toBe('2027-05-12');
    expect(photoDeletionDate('2026-11-12T23:30:00-05:00', '2026-01-01')).toBe('2027-05-13');
    expect(photoDeletionDate('2026-01-05T10:00:00Z', '2026-12-01')).toBe('2026-12-01');
  });

  it('shows a UTC date unchanged', () => {
    // ARU-109: in the app's language, not the device's locale.
    expect(formatUtcDate('2027-05-12')).toBe('12 May 2027');
    expect(formatUtcDate('2027-05-12', 'ru')).toBe('12 мая 2027');
  });
});

describe('the warning (AC 4)', () => {
  const start = '2026-11-01';
  it('counts own stored, checked photos due within 30 days, with the earliest date', () => {
    const list = [
      checked('h1', '2026-05-20T10:00:00Z'), // 20 Nov
      checked('h2', '2026-05-10T10:00:00Z'), // 10 Nov
      checked('h3', '2026-06-09T10:00:00Z'), // 9 Dec: 31 days away, not yet
      checked('h4', '2026-05-10T10:00:00Z', { photoUrl: undefined }), // file gone
      checked('h5', '2026-05-10T10:00:00Z', { studentId: 'S2' }), // someone else's
      photo('h6'), // not checked
      checked('h7', '2026-05-10T10:00:00Z', { photoPath: undefined, photoUrl: undefined }), // no photo
    ];
    expect(deletionWarning(list, 'S1', start, NOW)).toEqual({ count: 2, date: '2026-11-10' });
    expect(deletionWarning(list, 'S1', null, NOW)).toBeNull();
    expect(deletionWarning([checked('h3', '2026-06-09T10:00:00Z')], 'S1', start, NOW)).toBeNull();
    expect(deletionWarning([checked('h8', '2026-06-08T10:00:00Z')], 'S1', start, NOW)).toEqual({ count: 1, date: '2026-12-08' });
  });

  it('says photo for 1 and photos otherwise', () => {
    expect(deletionWarningText({ count: 1, date: '2026-11-10' })).toBe(
      `1 homework photo will be deleted on ${formatUtcDate('2026-11-10')}. Download them now.`,
    );
    expect(deletionWarningText({ count: 3, date: '2026-11-10' })).toMatch(/^3 homework photos will be deleted on /);
  });
});

describe('Homework tab (AC 4, AC 5, AC 6)', () => {
  const members = [member('A', 'S1'), member('A', 'M2'), member('B', 'S1')];
  const due = checked('due', '2026-05-20T10:00:00Z');
  const open = (who: 'S1' | 'M2' | 'T' | 'M', homework: Homework[], over = {}) => {
    const store = fakeStore(who, { courseMembers: members, visibleHomework: homework, photoDeletionStart: '2026-11-01', ...over });
    setStore(store);
    return store;
  };
  const banner = () => screen.queryByTestId('photo-deletion-banner');

  it('a student sees the banner on every list; it names the count and the earliest date', async () => {
    open('S1', [due]);
    await render(<HomeworkScreen />);
    expect(banner()).toBeTruthy();
    expect(screen.getByText(`1 homework photo will be deleted on ${formatUtcDate('2026-11-20')}. Download them now.`)).toBeTruthy();
    for (const tab of [/Waiting/, 'Checked']) {
      await fireEvent.press(screen.getByText(tab));
      expect(banner()).toBeTruthy();
    }
  });

  it('no banner while the start date is empty, or when nothing is due within 30 days', async () => {
    open('S1', [due], { photoDeletionStart: null });
    const view = await render(<HomeworkScreen />);
    expect(banner()).toBeNull();
    open('S1', [checked('later', '2026-06-20T10:00:00Z')]);
    await view.rerender(<HomeworkScreen />);
    expect(banner()).toBeNull();
  });

  it('a mentor sees it on the Listener side only, never on Owner; the teacher never', async () => {
    const mine = checked('m2', '2026-05-20T10:00:00Z', { studentId: 'M2', photoPath: 'M2/m2.jpg' });
    open('M2', [mine, due]);
    const view = await render(<HomeworkScreen />);
    expect(banner()).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: /Listener/ }));
    expect(banner()).toBeTruthy();
    expect(screen.getByText(/^1 homework photo will be deleted/)).toBeTruthy();
    open('T', [due]);
    await view.rerender(<HomeworkScreen />);
    expect(banner()).toBeNull();
  });

  it('Download my photos is on Checked, for the sender only; it asks for a link and opens it', async () => {
    const store = open('S1', [due, photo('waiting')]);
    await render(<HomeworkScreen />);
    expect(screen.queryByRole('button', { name: 'Download my photos' })).toBeNull();
    await fireEvent.press(screen.getByText('Checked'));
    await fireEvent.press(screen.getByRole('button', { name: 'Download my photos' }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://zip.example/link'));
    expect(store.requestPhotoZip).toHaveBeenCalledWith(undefined);
  });

  it('shows "Preparing…" while the link is made; a double tap asks once', async () => {
    let finish: (url: string) => void = () => {};
    const requestPhotoZip = jest.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    open('S1', [due], { requestPhotoZip });
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByText('Checked'));
    await fireEvent.press(screen.getByRole('button', { name: 'Download my photos' }));
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Preparing…' }));
    expect(requestPhotoZip).toHaveBeenCalledTimes(1);
    await act(async () => finish('https://zip.example/one'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://zip.example/one');
  });

  it('AC 9: a failure shows the message in red and changes nothing', async () => {
    open('S1', [due], { requestPhotoZip: jest.fn(async () => { throw new Error(PHOTOS_ZIP_ERROR); }) });
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByText('Checked'));
    await fireEvent.press(screen.getByRole('button', { name: 'Download my photos' }));
    expect(await screen.findByText(PHOTOS_ZIP_ERROR)).toBeTruthy();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('AC 9: a link that can\'t be opened shows the same message', async () => {
    (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('no handler'));
    open('S1', [due]);
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByText('Checked'));
    await fireEvent.press(screen.getByRole('button', { name: 'Download my photos' }));
    expect(await screen.findByText(PHOTOS_ZIP_ERROR)).toBeTruthy();
  });

  it('hidden without stored photos; the teacher and the Owner side never have it', async () => {
    open('S1', [checked('gone', '2026-05-20T10:00:00Z', { photoUrl: undefined })]);
    const view = await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByText('Checked'));
    expect(screen.queryByRole('button', { name: 'Download my photos' })).toBeNull();
    open('T', [due]);
    await view.rerender(<HomeworkScreen />);
    await fireEvent.press(screen.getByText('Checked'));
    expect(screen.queryByRole('button', { name: 'Download my photos' })).toBeNull();
  });

  it('AC 6: over 50 photos, the banner and the button open Download by course instead of a link', async () => {
    const many = Array.from({ length: 51 }, (_, i) => checked(`p${i}`, '2026-05-20T10:00:00Z'));
    const store = open('S1', many);
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Download photos' }));
    expect(router.push).toHaveBeenCalledWith('/homework/photos');
    expect(store.requestPhotoZip).not.toHaveBeenCalled();
  });
});

describe('Download by course (AC 6)', () => {
  const titles: Record<string, string> = { A: 'Algebra', B: 'Biology' };
  it('zipEntries: one entry per course, a course over 50 in parts, sorted by title', () => {
    const list = [
      ...Array.from({ length: 120 }, (_, i) => photo(`a${i}`)),
      photo('b1', { courseId: 'B' }),
    ];
    expect(zipEntries(list, (id) => titles[id]).map((e) => [e.title, e.part, e.parts, e.count])).toEqual([
      ['Algebra', 1, 3, 50],
      ['Algebra', 2, 3, 50],
      ['Algebra', 3, 3, 20],
      ['Biology', 1, 1, 1],
    ]);
  });

  it('lists the entries; each downloads its own course and part', async () => {
    const courses: Course[] = [courseA, courseB];
    const list = [...Array.from({ length: 51 }, (_, i) => photo(`a${i}`)), photo('b1', { courseId: 'B' })];
    const store = fakeStore('S1', { courses, visibleHomework: list });
    setStore(store);
    await render(<DownloadByCourseScreen />);
    expect(screen.getByRole('button', { name: 'Download Algebra · Part 1 of 2 · 50 photos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Algebra · Part 2 of 2 · 1 photo' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Download Biology · 1 photo' }));
    await waitFor(() => expect(store.requestPhotoZip).toHaveBeenCalledWith({ courseId: 'B', part: 1 }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://zip.example/link');
    await fireEvent.press(screen.getByRole('button', { name: 'Download Algebra · Part 2 of 2 · 1 photo' }));
    await waitFor(() => expect(store.requestPhotoZip).toHaveBeenLastCalledWith({ courseId: 'A', part: 2 }));
  });

  it('an entry\'s failure shows under that entry only', async () => {
    const list = [photo('a1'), photo('b1', { courseId: 'B' })];
    setStore(fakeStore('S1', { visibleHomework: list, requestPhotoZip: jest.fn(async () => { throw new Error('x'); }) }));
    await render(<DownloadByCourseScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Download Biology · 1 photo' }));
    expect(await screen.findAllByText(PHOTOS_ZIP_ERROR)).toHaveLength(1);
  });

  it('nothing to download: an empty state; only own stored photos count', async () => {
    setStore(fakeStore('S1', { visibleHomework: [photo('x', { studentId: 'S2' }), photo('y', { photoUrl: undefined })] }));
    await render(<DownloadByCourseScreen />);
    expect(screen.getByText('No photos to download')).toBeTruthy();
    expect(storedOwnPhotos([photo('z')], undefined)).toEqual([]);
  });
});

describe('Add homework (AC 8)', () => {
  it('shows the rule under Photo', async () => {
    const assignment: HomeworkAssignment = {
      id: 'a1',
      courseId: 'A',
      meetingId: 'C1',
      title: 'Fractions',
      description: '',
      createdById: 'M',
      createdAt: '2026-10-20T10:00:00.000Z',
    };
    params.assignmentId = 'a1';
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], assignments: [assignment] }));
    await render(<NewHomeworkScreen />);
    expect(screen.getByText(PHOTO_RULE)).toBeTruthy();
    expect(PHOTO_RULE).toBe('Photos are kept for 6 months after the homework is checked, then deleted.');
  });
});
