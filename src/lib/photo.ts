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

export const PHOTO_ERROR = "Couldn't load the photo. Check your connection and try again.";
