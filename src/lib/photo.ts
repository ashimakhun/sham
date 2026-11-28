import type { Homework, HomeworkPhoto } from './types';

/** File name for a downloaded homework photo (ARU-18): the homework title made safe for every file system,
 *  plus the start of the homework id so two homework items with the same title don't clash. */
export function photoFileName(title: string, id: string) {
  const safe = title
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 60)
    .replace(/[_.]+$/g, '');
  return `${safe || 'homework'}-${id.slice(0, 8)}.jpg`;
}

/** ARU-75 (AC 12 b): a homework whose photo file is gone (or whose link couldn't be made) shows this instead. */
export const PHOTO_UNAVAILABLE = 'Photo unavailable';

export const PHOTO_ERROR = "Couldn't load the photo. Check your connection and try again.";

/** ARU-191: at most this many photos per homework (the database refuses more). */
export const MAX_HOMEWORK_PHOTOS = 10;

/** ARU-191: a homework's photos in order; a homework that only has photoPath (sent before ARU-191, or loaded by an
 *  older code path) is one photo. */
export function homeworkPhotos(h: Pick<Homework, 'photos' | 'photoPath' | 'photoUrl'>): HomeworkPhoto[] {
  if (h.photos?.length) return h.photos;
  return h.photoPath || h.photoUrl ? [{ path: h.photoPath ?? '', url: h.photoUrl }] : [];
}

/** ARU-191: the photos still stored (a missing file has no signed URL). */
export function storedPhotos(h: Pick<Homework, 'photos' | 'photoPath' | 'photoUrl'>): HomeworkPhoto[] {
  return homeworkPhotos(h).filter((p) => !!p.url);
}
