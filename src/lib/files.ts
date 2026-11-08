// Knowledge base PDFs (ARU-30): limits and helpers shared by the screens and the store.
import { currentLanguage, formatNumberIn, type Language, translate } from '@/i18n';

import type { MaterialFileEdit, PickedFile } from './types';

/** 25 MB, the same limit as the "materials" bucket (0018_material_files.sql). */
export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const FILE_NAME_MAX = 200;
export const FILE_DESCRIPTION_MAX = 2000;

export const PDF_RULE = 'The file must be a PDF up to 25 MB.';
export const OPEN_FAILED = "Couldn't open the file. Check your connection and try again.";

/** A PDF by its type or, when the platform gives no type, by its name. Unknown size passes (the bucket checks it). */
export function isAllowedPdf(file: Pick<PickedFile, 'name' | 'mimeType' | 'size'>) {
  const pdf = file.mimeType ? file.mimeType === 'application/pdf' : /\.pdf$/i.test(file.name);
  return pdf && (file.size === undefined || file.size <= PDF_MAX_BYTES);
}

/** The prefilled name: the file name without ".pdf", or "Untitled" when the picker gives none. */
export function nameFromFile(fileName: string | undefined) {
  const name = (fileName ?? '').trim().replace(/\.pdf$/i, '').trim().slice(0, FILE_NAME_MAX);
  return name || translate(currentLanguage(), 'files.untitled');
}

/**
 * "—" when unknown; otherwise bytes, KB or MB (one decimal under 10), in the app's language (ARU-113 AC 4):
 * "1.2 MB" / "1,2 МБ".
 */
export function formatSize(bytes: number | undefined, lang: Language = currentLanguage()) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  const size = (value: number, unit: 'b' | 'kb' | 'mb') => {
    const n = unit !== 'b' && value < 10 ? value.toFixed(1) : String(Math.round(value));
    return translate(lang, `files.size.${unit}`, { n: lang === 'ru' ? n.replace('.', ',') : n });
  };
  if (bytes < 1024) return size(bytes, 'b');
  const kb = bytes / 1024;
  if (kb < 1024) return size(kb, 'kb');
  return size(kb / 1024, 'mb');
}

/** ARU-113 AC 4: a limit such as "2,000" / "2 000". */
export const formatLimit = (n: number, lang: Language = currentLanguage()) => formatNumberIn(lang, n);

/** Characters as Postgres counts them (code points), so an emoji counts once. */
const chars = (s: string) => [...s].length;

/** Same rules as the database (after trimming): a readable message, or null when the entries are fine. */
export function fileFieldsError(input: Pick<MaterialFileEdit, 'name' | 'description'>): string | null {
  const name = input.name.trim();
  if (!name) return 'Enter a name.';
  if (chars(name) > FILE_NAME_MAX) return 'The name can be at most 200 characters.';
  if (chars(input.description.trim()) > FILE_DESCRIPTION_MAX) return 'The description can be at most 2,000 characters.';
  return null;
}
