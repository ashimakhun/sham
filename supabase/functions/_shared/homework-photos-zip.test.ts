/**
 * @jest-environment node
 */
// ARU-107 (part a): the homework-photos-zip function's logic with Supabase mocked: who gets a link, which photos a
// link covers, the one-time use, HEAD probes, file names and what fails (AC 5–7, 9, 10).
import {
  handlePhotoZipRequest,
  LINK_EXPIRED,
  LINK_SECONDS,
  PHOTO_ZIP_MAX,
  pickPhotos,
  type PhotoZipDeps,
  safeName,
  zipFileNames,
  type ZipPhoto,
} from './homework-photos-zip';

const FN = 'https://x.supabase.co/functions/v1/homework-photos-zip';
const NOW = new Date('2026-11-08T10:00:00Z');

const photo = (n: number, over: Partial<ZipPhoto> = {}): ZipPhoto => ({
  homework_id: `h${n}`,
  photo_path: `u-me/h${n}.jpg`,
  course_id: 'A',
  course_title: 'Algebra',
  homework_title: `Homework ${n}`,
  assignment_title: `Assignment ${n}`,
  sent_at: '2026-10-05T23:30:00Z',
  ...over,
});

type Link = { tokenHash: string; userId: string; homeworkIds: string[]; expiresAt: string; used?: boolean };

function setup(photosByUser: Record<string, ZipPhoto[]> = { 'u-me': [photo(1), photo(2)] }, over: Partial<PhotoZipDeps> = {}) {
  const links: Link[] = [];
  const downloads: string[] = [];
  let n = 0;
  let clock = NOW;
  const d: PhotoZipDeps = {
    userFromToken: jest.fn(async (jwt: string) => (jwt.startsWith('jwt-') ? { id: `u-${jwt.slice(4)}` } : null)),
    photosFor: jest.fn(async (id: string) => photosByUser[id] ?? []),
    saveLink: jest.fn(async (l) => {
      links.push({ ...l });
    }),
    claimLink: jest.fn(async (hash: string) => {
      const l = links.find((x) => x.tokenHash === hash && !x.used && new Date(x.expiresAt) > clock);
      if (!l) return null;
      l.used = true;
      return { userId: l.userId, homeworkIds: l.homeworkIds };
    }),
    download: jest.fn(async (path: string) => {
      downloads.push(path);
      return new TextEncoder().encode(`jpeg:${path}`);
    }),
    zip: jest.fn((files) => new TextEncoder().encode(JSON.stringify(files.map((f: { name: string }) => f.name)))),
    newToken: () => `tok${++n}`,
    hash: async (t: string) => `hash:${t}`,
    functionUrl: FN,
    now: () => clock,
    ...over,
  };
  return { d, links, downloads, setClock: (c: Date) => (clock = c) };
}

const post = (body: unknown = {}, auth: string | null = 'Bearer jwt-me') =>
  new Request(FN, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const open = (url: string, method = 'GET') => new Request(url, { method });
const zipNames = async (res: Response) => JSON.parse(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer())));

describe('POST: making a link (AC 5, AC 7)', () => {
  it('returns a one-time link for the caller\'s own photos, valid for 60 seconds; only its hash is stored', async () => {
    const { d, links } = setup();
    const res = await handlePhotoZipRequest(post(), d);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ url: `${FN}?token=tok1`, expiresAt: new Date(NOW.getTime() + LINK_SECONDS * 1000).toISOString(), count: 2 });
    expect(links).toEqual([expect.objectContaining({ tokenHash: 'hash:tok1', userId: 'u-me', homeworkIds: ['h1', 'h2'] })]);
    expect(JSON.stringify(links)).not.toContain('"tok1"');
  });

  it.each([
    ['no token', null],
    ['a bad token', 'Bearer nope'],
    ['a malformed header', 'Basic abc'],
  ])('%s: 401 and no link', async (_l, auth) => {
    const { d, links } = setup();
    const res = await handlePhotoZipRequest(post({}, auth), d);
    expect(res.status).toBe(401);
    expect(links).toEqual([]);
  });

  it('the body can\'t name another user: a teacher or another student only ever gets their own photos (none here)', async () => {
    const { d, links } = setup({ 'u-me': [photo(1)], 'u-teacher': [] });
    const res = await handlePhotoZipRequest(post({ userId: 'u-me', courseId: 'A' }, 'Bearer jwt-teacher'), d);
    expect(res.status).toBe(404);
    expect(d.photosFor).toHaveBeenCalledWith('u-teacher');
    expect(links).toEqual([]);
  });

  it('a waiting or declined account (homework_photos_for_zip returns nothing) gets no link', async () => {
    const { d } = setup({});
    expect((await handlePhotoZipRequest(post(), d)).status).toBe(404);
  });

  it('over 50 photos without a course: 409 "by_course", no link (the app shows Download by course)', async () => {
    const many = Array.from({ length: PHOTO_ZIP_MAX + 1 }, (_, i) => photo(i));
    const { d, links } = setup({ 'u-me': many });
    const res = await handlePhotoZipRequest(post(), d);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('by_course');
    expect(links).toEqual([]);
  });

  it('AC 6: a course in parts of 50', async () => {
    const many = [
      ...Array.from({ length: 120 }, (_, i) => photo(i)),
      photo(500, { course_id: 'B', course_title: 'Biology' }),
    ];
    const { d, links } = setup({ 'u-me': many });
    for (const [part, count] of [[1, 50], [2, 50], [3, 20]]) {
      const res = await handlePhotoZipRequest(post({ courseId: 'A', part }), d);
      expect((await res.json()).count).toBe(count);
    }
    expect(links[2].homeworkIds[0]).toBe('h100');
    expect((await handlePhotoZipRequest(post({ courseId: 'A', part: 4 }), d)).status).toBe(404);
    const b = await handlePhotoZipRequest(post({ courseId: 'B' }), d);
    expect((await b.json()).count).toBe(1);
  });

  it.each([
    ['not JSON', '{oops'],
    ['a non-string course', { courseId: 5 }],
    ['a non-number part', { courseId: 'A', part: '2' }],
  ])('%s: 400', async (_l, body) => {
    const { d } = setup();
    expect((await handlePhotoZipRequest(post(body), d)).status).toBe(400);
  });

  it('a database failure: 500, nothing stored', async () => {
    const { d, links } = setup(undefined, { photosFor: jest.fn(async () => { throw new Error('db down'); }) });
    expect((await handlePhotoZipRequest(post(), d)).status).toBe(500);
    expect(links).toEqual([]);
  });

  it('OPTIONS answers the browser\'s preflight; PUT is refused', async () => {
    const { d } = setup();
    const pre = await handlePhotoZipRequest(new Request(FN, { method: 'OPTIONS' }), d);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect((await handlePhotoZipRequest(new Request(FN, { method: 'PUT' }), d)).status).toBe(405);
  });
});

describe('GET: using a link (AC 5, AC 7, AC 10)', () => {
  it('serves the ZIP once, as an attachment named sham-homework-photos-<date>.zip; a second use gets 410', async () => {
    const { d } = setup();
    const { url } = await (await handlePhotoZipRequest(post(), d)).json();
    const res = await handlePhotoZipRequest(open(url), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="sham-homework-photos-2026-11-08.zip"');
    expect(await zipNames(res)).toEqual([
      'Algebra - Assignment 1 - 2026-10-05.jpg',
      'Algebra - Assignment 2 - 2026-10-05.jpg',
    ]);
    const again = await handlePhotoZipRequest(open(url), d);
    expect(again.status).toBe(410);
    expect(await again.text()).toBe(LINK_EXPIRED);
  });

  it('HEAD probes don\'t use the link up', async () => {
    const { d } = setup();
    const { url } = await (await handlePhotoZipRequest(post(), d)).json();
    const head = await handlePhotoZipRequest(open(url, 'HEAD'), d);
    expect(head.status).toBe(200);
    expect(d.claimLink).not.toHaveBeenCalled();
    expect((await handlePhotoZipRequest(open(url), d)).status).toBe(200);
  });

  it('after 60 seconds the link returns nothing', async () => {
    const { d, setClock } = setup();
    const { url } = await (await handlePhotoZipRequest(post(), d)).json();
    setClock(new Date(NOW.getTime() + 61_000));
    expect((await handlePhotoZipRequest(open(url), d)).status).toBe(410);
    expect(d.download).not.toHaveBeenCalled();
  });

  it.each([
    ['a forged token', `${FN}?token=forged`],
    ['no token', FN],
  ])('%s returns nothing', async (_l, url) => {
    const { d } = setup();
    expect((await handlePhotoZipRequest(open(url), d)).status).toBe(410);
    expect(d.download).not.toHaveBeenCalled();
  });

  it('re-reads the user\'s photos: one they can no longer read, or whose file is gone, is left out', async () => {
    const photos = { 'u-me': [photo(1), photo(2), photo(3)] };
    const { d } = setup(photos, {
      download: jest.fn(async (path: string) => (path.endsWith('h3.jpg') ? null : new Uint8Array([1]))),
    });
    const { url } = await (await handlePhotoZipRequest(post(), d)).json();
    photos['u-me'] = [photo(2), photo(3)]; // h1 no longer readable
    const names = await zipNames(await handlePhotoZipRequest(open(url), d));
    expect(names).toEqual(['Algebra - Assignment 2 - 2026-10-05.jpg']);
  });

  it('only ever downloads the link owner\'s photos, never deletes or changes anything', async () => {
    const { d, downloads } = setup({ 'u-me': [photo(1)], 'u-other': [photo(9, { photo_path: 'u-other/h9.jpg' })] });
    const { url } = await (await handlePhotoZipRequest(post(), d)).json();
    await handlePhotoZipRequest(open(url), d);
    expect(downloads).toEqual(['u-me/h1.jpg']);
    expect(Object.keys(d)).not.toContain('remove');
  });

  it('a storage failure: 500 with a message, no ZIP', async () => {
    const { d } = setup(undefined, { download: jest.fn(async () => { throw new Error('storage down'); }) });
    const { url } = await (await handlePhotoZipRequest(post(), d)).json();
    const res = await handlePhotoZipRequest(open(url), d);
    expect(res.status).toBe(500);
    expect(d.zip).not.toHaveBeenCalled();
  });
});

describe('file names (AC 5)', () => {
  it('uses the assignment, else the homework title; the send date is the UTC day; repeats get (2), (3)', () => {
    expect(
      zipFileNames([
        photo(1),
        photo(2, { assignment_title: null, homework_title: 'My essay' }),
        photo(3, { assignment_title: 'Assignment 1' }),
        photo(4, { assignment_title: 'assignment 1' }),
      ]),
    ).toEqual([
      'Algebra - Assignment 1 - 2026-10-05.jpg',
      'Algebra - My essay - 2026-10-05.jpg',
      'Algebra - Assignment 1 - 2026-10-05 (2).jpg',
      'Algebra - assignment 1 - 2026-10-05 (3).jpg',
    ]);
  });

  it('removes characters files can\'t have', () => {
    expect(safeName(' a/b\\c:d*e?f"g<h>i|j\u0001 ')).toBe('a b c d e f g h i j');
    expect(safeName('..hidden')).toBe('hidden');
    expect(zipFileNames([photo(1, { course_title: '///', assignment_title: '' , homework_title: '' })])[0]).toBe(
      'Course - Homework - 2026-10-05.jpg',
    );
  });

  it('pickPhotos keeps the order and refuses bad parts', () => {
    const p = [photo(1), photo(2, { course_id: 'B' })];
    expect(pickPhotos(p)).toEqual(p);
    expect(pickPhotos(p, 'B')).toEqual([p[1]]);
    expect(pickPhotos(p, 'B', 0)).toBeNull();
    expect(pickPhotos(p, 'B', 1.5)).toBeNull();
  });
});
