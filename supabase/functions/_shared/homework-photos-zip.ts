// ARU-107 (part a): "Download my photos". The homework-photos-zip Edge Function has two entrances:
//   POST (the app, "Authorization: Bearer <user jwt>", body {"courseId"?, "part"?}): picks the caller's own stored
//       homework photos (homework_photos_for_zip(), migration 0049), at most PHOTO_ZIP_MAX of them, and returns a
//       one-time link valid for LINK_SECONDS: {"url", "expiresAt", "count"}. Only a hash of the token is stored.
//   GET  ?token=… (the link, opened by the browser or the system viewer, which can't send an auth header): uses the
//       link once and streams sham-homework-photos-<date>.zip. HEAD requests (prefetches, Quick Look probes) answer
//       without using the link. A used, expired or unknown link answers 410 with no files.
// Only the token's user is ever served: the body can't name another user, and the GET re-reads that user's photos, so
// homework they can no longer read is left out (AC 7). Nothing is deleted or changed (AC 10).
// No Deno-only imports, so Jest can test it.

/** At most this many photos in one ZIP (AC 6), so a ZIP stays within the function's memory and time limits. */
export const PHOTO_ZIP_MAX = 50;
/** A link works once, within this many seconds (AC 5). */
export const LINK_SECONDS = 60;

export const LINK_EXPIRED = 'This download link has expired or was already used. Tap Download again in Sham.';

/** A row of homework_photos_for_zip(user). */
export type ZipPhoto = {
  homework_id: string;
  photo_path: string;
  course_id: string;
  course_title: string;
  homework_title: string;
  assignment_title: string | null;
  sent_at: string;
};

export type PhotoZipDeps = {
  /** The user the access token belongs to; null for a bad or expired token. Throws on other errors. */
  userFromToken: (jwt: string) => Promise<{ id: string } | null>;
  /** homework_photos_for_zip(user): empty for waiting, declined or unknown users. Throws on a database error. */
  photosFor: (userId: string) => Promise<ZipPhoto[]>;
  /** Stores a new link (its token hash). Throws on failure. */
  saveLink: (link: { tokenHash: string; userId: string; homeworkIds: string[]; expiresAt: string }) => Promise<void>;
  /** claim_photo_zip_link(hash): the link's user and homework if it is unused and unexpired (and marks it used). */
  claimLink: (tokenHash: string) => Promise<{ userId: string; homeworkIds: string[] } | null>;
  /** The photo's bytes from the homework bucket, or null when the file is gone. Throws on other errors. */
  download: (path: string) => Promise<Uint8Array | null>;
  /** Builds the ZIP (stored, not recompressed: the photos are JPEGs already). */
  zip: (files: { name: string; data: Uint8Array }[]) => Uint8Array;
  /** A new random token (URL-safe) and its hash. */
  newToken: () => string;
  hash: (token: string) => Promise<string>;
  /** This function's public URL, e.g. https://<ref>.supabase.co/functions/v1/homework-photos-zip. */
  functionUrl: string;
  now?: () => Date;
  log?: (line: string) => void;
};

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The UTC calendar date, YYYY-MM-DD. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Characters files can't have on Windows, macOS, iOS or Android, and control characters, become spaces. */
export function safeName(s: string) {
  const clean = s
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  return clean.slice(0, 80).trim();
}

/** AC 5: "<Course> - <Assignment> - <YYYY-MM-DD>.jpg" (the day it was sent, UTC; the homework title without an
 *  assignment), with " (2)", " (3)" for repeats, in the order given. */
export function zipFileNames(photos: ZipPhoto[]): string[] {
  const used = new Map<string, number>();
  return photos.map((p) => {
    const course = safeName(p.course_title) || 'Course';
    const what = safeName(p.assignment_title ?? '') || safeName(p.homework_title) || 'Homework';
    const base = `${course} - ${what} - ${utcDay(new Date(p.sent_at))}`;
    const key = base.toLowerCase();
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    return n === 1 ? `${base}.jpg` : `${base} (${n}).jpg`;
  });
}

/** AC 5–6: the photos one request asks for. Without a course: all of them, if there are at most PHOTO_ZIP_MAX. With a
 *  course: that course's part `part` (1-based) of PHOTO_ZIP_MAX photos each. Null for a part or set that doesn't fit. */
export function pickPhotos(photos: ZipPhoto[], courseId?: string | null, part = 1): ZipPhoto[] | null {
  if (!courseId) return photos.length <= PHOTO_ZIP_MAX ? photos : null;
  const inCourse = photos.filter((p) => p.course_id === courseId);
  if (!Number.isInteger(part) || part < 1) return null;
  const slice = inCourse.slice((part - 1) * PHOTO_ZIP_MAX, part * PHOTO_ZIP_MAX);
  return slice.length ? slice : null;
}

async function createLink(request: Request, deps: PhotoZipDeps): Promise<Response> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!jwt) return json({ error: 'Not signed in.' }, 401);
  let body: { courseId?: unknown; part?: unknown } = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  if (body.courseId != null && typeof body.courseId !== 'string') return json({ error: 'Bad request.' }, 400);
  if (body.part != null && typeof body.part !== 'number') return json({ error: 'Bad request.' }, 400);

  try {
    const user = await deps.userFromToken(jwt);
    if (!user) return json({ error: 'Not signed in.' }, 401);
    // Approved accounts only; only the caller's own photos (homework_photos_for_zip).
    const photos = await deps.photosFor(user.id);
    if (!photos.length) return json({ error: 'No photos to download.' }, 404);
    const chosen = pickPhotos(photos, body.courseId as string | undefined, (body.part as number | undefined) ?? 1);
    if (!chosen) {
      return body.courseId
        ? json({ error: 'No photos to download.' }, 404)
        : json({ error: 'Too many photos for one ZIP: download them by course.', code: 'by_course' }, 409);
    }
    const token = deps.newToken();
    const now = (deps.now ?? (() => new Date()))();
    const expiresAt = new Date(now.getTime() + LINK_SECONDS * 1000).toISOString();
    await deps.saveLink({
      tokenHash: await deps.hash(token),
      userId: user.id,
      homeworkIds: chosen.map((p) => p.homework_id),
      expiresAt,
    });
    deps.log?.(`link for ${user.id}: ${chosen.length} photo(s)`);
    return json({ url: `${deps.functionUrl}?token=${encodeURIComponent(token)}`, expiresAt, count: chosen.length }, 200);
  } catch (e) {
    deps.log?.(`link failed: ${message(e)}`);
    return json({ error: "Couldn't prepare your photos." }, 500);
  }
}

async function serveZip(request: Request, deps: PhotoZipDeps): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const now = (deps.now ?? (() => new Date()))();
  const fileName = `sham-homework-photos-${utcDay(now)}.zip`;
  const zipHeaders = {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${fileName}"`,
    'cache-control': 'no-store',
    ...CORS_HEADERS,
  };
  const gone = () =>
    new Response(request.method === 'HEAD' ? null : LINK_EXPIRED, {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...CORS_HEADERS },
    });
  if (!token) return gone();
  // A probe (prefetch, Quick Look) must not use the link up.
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: zipHeaders });

  try {
    const link = await deps.claimLink(await deps.hash(token));
    if (!link) return gone();
    const wanted = new Set(link.homeworkIds);
    // Re-read the user's photos now: anything they can no longer read, or that is gone, is left out.
    const photos = (await deps.photosFor(link.userId)).filter((p) => wanted.has(p.homework_id));
    const names = zipFileNames(photos);
    const files: { name: string; data: Uint8Array }[] = [];
    for (let i = 0; i < photos.length; i++) {
      const data = await deps.download(photos[i].photo_path);
      if (data) files.push({ name: names[i], data });
    }
    if (!files.length) return gone();
    const zip = deps.zip(files);
    deps.log?.(`zip for ${link.userId}: ${files.length} photo(s), ${zip.byteLength} bytes`);
    return new Response(zip, { status: 200, headers: { ...zipHeaders, 'content-length': String(zip.byteLength) } });
  } catch (e) {
    deps.log?.(`zip failed: ${message(e)}`);
    return new Response("Couldn't prepare your photos. Try again in Sham.", {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS_HEADERS },
    });
  }
}

/** The function: OPTIONS (CORS), POST (make a link), GET / HEAD (serve a link). */
export async function handlePhotoZipRequest(request: Request, deps: PhotoZipDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method === 'POST') return createLink(request, deps);
  if (request.method === 'GET' || request.method === 'HEAD') return serveZip(request, deps);
  return json({ error: 'Method not allowed' }, 405);
}
