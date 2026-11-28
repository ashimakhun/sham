/**
 * @jest-environment node
 */
// ARU-191 AC 10: Download by course with several photos per homework. homework_photos_for_zip() (0081) gives one row
// per photo with its position and the homework's photo count: each photo counts toward the 50 per ZIP, the photos of
// one homework are numbered so they sort together, and a link serves exactly its own photos (a homework's photos may
// be split over two parts).
import { handlePhotoZipRequest, PHOTO_ZIP_MAX, pickPhotos, type PhotoZipDeps, zipFileNames, type ZipPhoto } from './homework-photos-zip';

const FN = 'https://x.supabase.co/functions/v1/homework-photos-zip';

/** Photo `pos` of homework `hw` (which has `count` photos). */
const photo = (hw: number, pos: number, count: number, over: Partial<ZipPhoto> = {}): ZipPhoto => ({
  homework_id: `h${hw}`,
  photo_path: `u-me/h${hw}/${pos}.jpg`,
  course_id: 'A',
  course_title: 'Algebra',
  homework_title: `Homework ${hw}`,
  assignment_title: `Assignment ${hw}`,
  sent_at: '2026-10-05T10:00:00Z',
  position: pos,
  photo_count: count,
  ...over,
});
const homework = (hw: number, count: number, over: Partial<ZipPhoto> = {}) =>
  Array.from({ length: count }, (_, i) => photo(hw, i + 1, count, over));

type Link = { tokenHash: string; userId: string; homeworkIds: string[]; photoPaths: string[]; used?: boolean };

function setup(photos: ZipPhoto[]) {
  const links: Link[] = [];
  const downloads: string[] = [];
  let n = 0;
  const d: PhotoZipDeps = {
    userFromToken: async () => ({ id: 'u-me' }),
    photosFor: async () => photos,
    saveLink: async (l) => {
      links.push({ ...l });
    },
    claimLink: async (hash) => {
      const l = links.find((x) => x.tokenHash === hash && !x.used);
      if (!l) return null;
      l.used = true;
      return { userId: l.userId, homeworkIds: l.homeworkIds, photoPaths: l.photoPaths };
    },
    download: async (path) => {
      downloads.push(path);
      return new TextEncoder().encode(path);
    },
    zip: (files) => new TextEncoder().encode(JSON.stringify(files.map((f) => f.name))),
    newToken: () => `tok${++n}`,
    hash: async (t) => `hash:${t}`,
    functionUrl: FN,
    now: () => new Date('2026-11-08T10:00:00Z'),
  };
  return { d, links, downloads };
}

const post = (body: unknown = {}) =>
  new Request(FN, { method: 'POST', headers: { authorization: 'Bearer jwt-me' }, body: JSON.stringify(body) });
async function download(d: PhotoZipDeps, body: unknown = {}) {
  const res = await handlePhotoZipRequest(post(body), d);
  const { url } = await res.json();
  const zip = await handlePhotoZipRequest(new Request(url), d);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(await zip.arrayBuffer()))) as string[];
}

describe('file names', () => {
  it('2 homework × 3 photos: 6 files, numbered per homework so they sort together', () => {
    const names = zipFileNames([...homework(1, 3), ...homework(2, 3)]);
    expect(names).toEqual([
      'Algebra - Assignment 1 - 2026-10-05 1.jpg',
      'Algebra - Assignment 1 - 2026-10-05 2.jpg',
      'Algebra - Assignment 1 - 2026-10-05 3.jpg',
      'Algebra - Assignment 2 - 2026-10-05 1.jpg',
      'Algebra - Assignment 2 - 2026-10-05 2.jpg',
      'Algebra - Assignment 2 - 2026-10-05 3.jpg',
    ]);
    expect([...names].sort()).toEqual(names);
  });

  it('AC 8: a one-photo homework keeps its name without a number', () => {
    expect(zipFileNames(homework(1, 1))).toEqual(['Algebra - Assignment 1 - 2026-10-05.jpg']);
  });

  it('two homework with the same name: the repeat is counted per homework, then numbered', () => {
    const same = { assignment_title: 'Same' };
    expect(zipFileNames([...homework(1, 2, same), ...homework(2, 2, same)])).toEqual([
      'Algebra - Same - 2026-10-05 1.jpg',
      'Algebra - Same - 2026-10-05 2.jpg',
      'Algebra - Same - 2026-10-05 (2) 1.jpg',
      'Algebra - Same - 2026-10-05 (2) 2.jpg',
    ]);
  });

  it('a homework split over two parts numbers its photos by position in both', () => {
    expect(zipFileNames([photo(7, 3, 4), photo(7, 4, 4)])).toEqual([
      'Algebra - Assignment 7 - 2026-10-05 3.jpg',
      'Algebra - Assignment 7 - 2026-10-05 4.jpg',
    ]);
  });
});

describe('parts and links', () => {
  // 6 homework × 9 photos = 54 photos in course A.
  const many = Array.from({ length: 6 }, (_, i) => homework(i + 1, 9)).flat();

  it('each photo counts toward the 50: 54 photos need Download by course, in 2 stable parts', async () => {
    expect(pickPhotos(many)).toBeNull();
    expect(pickPhotos(many, 'A', 1)).toHaveLength(PHOTO_ZIP_MAX);
    expect(pickPhotos(many, 'A', 2)).toHaveLength(4);
    const { d } = setup(many);
    const res = await handlePhotoZipRequest(post(), d);
    expect(res.status).toBe(409);
  });

  it('a link remembers its exact photos: part 2 serves only the 4 photos left, with their numbers', async () => {
    const { d, links } = setup(many);
    const names = await download(d, { courseId: 'A', part: 2 });
    expect(links[0].homeworkIds).toEqual(['h6']);
    expect(links[0].photoPaths).toEqual(['u-me/h6/6.jpg', 'u-me/h6/7.jpg', 'u-me/h6/8.jpg', 'u-me/h6/9.jpg']);
    expect(names).toEqual([6, 7, 8, 9].map((n) => `Algebra - Assignment 6 - 2026-10-05 ${n}.jpg`));
  });

  it('part 1 serves 50 photos, not every photo of its last homework', async () => {
    const { d, downloads } = setup(many);
    const names = await download(d, { courseId: 'A', part: 1 });
    expect(names).toHaveLength(50);
    expect(downloads).not.toContain('u-me/h6/6.jpg');
    expect(new Set(names).size).toBe(50);
  });

  it('a link made before ARU-191 (no photo list) still serves its homework', async () => {
    const { d, links } = setup(homework(1, 3));
    const res = await handlePhotoZipRequest(post(), d);
    const { url } = await res.json();
    links[0].photoPaths = undefined as unknown as string[];
    const zip = await handlePhotoZipRequest(new Request(url), d);
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(await zip.arrayBuffer())))).toHaveLength(3);
  });
});
