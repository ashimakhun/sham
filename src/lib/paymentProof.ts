// ARU-99: payment proofs (one photo or one PDF per request). Shared by the Pay screen and the store.
import type { PickedProof } from './types';

/** 10 MB, the same limit as the "payment-proofs" bucket (0047_payment_requests.sql). */
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;

export const PROOF_RULE = 'The proof must be a photo or a PDF up to 10 MB.';
export const PROOF_LOAD_ERROR = "Couldn't load the proof";
export const PHOTO_PERMISSION =
  'Sham needs access to your photos to attach a proof. Allow it in Settings, or attach a PDF instead.';

/** A photo (the picker returns images only) or a PDF by its type, or by its name when the platform gives no type.
 *  An unknown size passes here; the store checks what it actually read, and the bucket checks again. */
export function isAllowedProof(file: PickedProof) {
  const typeOk =
    file.kind === 'image'
      ? !file.mimeType || file.mimeType.startsWith('image/')
      : file.mimeType
        ? file.mimeType === 'application/pdf'
        : /\.pdf$/i.test(file.name ?? '');
  return typeOk && (file.size == null || file.size <= PROOF_MAX_BYTES);
}

/** The Storage extension and content type of a proof. Photos are always sent as JPEG (the picker converts them). */
export function proofFormat(kind: PickedProof['kind']) {
  return kind === 'pdf' ? { ext: 'pdf', contentType: 'application/pdf' } : { ext: 'jpg', contentType: 'image/jpeg' };
}

const safe = (s: string) =>
  s
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 40)
    .replace(/[_.]+$/g, '');

/** AC 9: e.g. "payment-proof-Algebra-Student_Sam.jpg". */
export function proofFileName(course: string, listener: string, kind: PickedProof['kind'] = 'image') {
  return `payment-proof-${safe(course) || 'course'}-${safe(listener) || 'listener'}.${proofFormat(kind).ext}`;
}
