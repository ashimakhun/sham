// ARU-105: homework and payment-proof photos are resized and compressed as soon as they are picked, so the stored
// file is small (about 200–400 KB for a phone photo) and the preview shows exactly what will be uploaded.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** The longest side of a stored photo, in pixels (AC 1). Smaller photos are never enlarged. */
export const PHOTO_MAX_SIDE = 1600;
/** JPEG quality of a stored photo (AC 2). */
export const PHOTO_QUALITY = 0.75;

export const PHOTO_PREPARE_ERROR = "Couldn't prepare this photo. Try another one.";
/** AC 7: the "homework" bucket refused the upload (over 10 MB or not a JPEG). */
export const PHOTO_TOO_LARGE = 'The photo must be up to 10 MB.';

/** The resize to apply so the longest side is at most PHOTO_MAX_SIDE, or null when the photo is small enough. */
export function resizeFor(width: number, height: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= PHOTO_MAX_SIDE) return null;
  return width >= height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE };
}

export type PreparedPhoto = { uri: string; width: number; height: number; size: number };

/**
 * Loads the picked photo (any format the platform reads: JPEG, PNG, HEIC on iOS, a blob/data URL on web), applies
 * its orientation, shrinks it to PHOTO_MAX_SIDE on the longest side and saves it as a JPEG. Throws
 * PHOTO_PREPARE_ERROR when the photo can't be read or saved (AC 6).
 */
export async function preparePhoto(uri: string): Promise<PreparedPhoto> {
  try {
    const context = ImageManipulator.manipulate(uri);
    const original = await context.renderAsync();
    const resize = resizeFor(original.width, original.height);
    const image = resize ? await context.resize(resize).renderAsync() : original;
    // base64 gives the saved file's size on every platform without reading the file again (the Pay screen checks it
    // against the 10 MB rule, AC 5).
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY, base64: true });
    const size = base64Bytes(saved.base64 ?? '');
    if (!size) throw new Error('empty photo');
    return { uri: saved.uri, width: saved.width, height: saved.height, size };
  } catch {
    throw new Error(PHOTO_PREPARE_ERROR);
  }
}

/** The number of bytes a base64 string encodes. */
export function base64Bytes(base64: string) {
  const clean = base64.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}
