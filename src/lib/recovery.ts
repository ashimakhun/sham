// ARU-165: personal recovery codes (Forgot password without email). The server makes the code and keeps only its
// hash (supabase/migrations/0073_recovery_codes.sql); the app shows it once and checks what is typed before sending.
import { Platform } from 'react-native';

import { translate } from '@/i18n';

/** The characters a code is made of: no 0, O, 1, I or L. The same alphabet is in 0073. */
export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_LENGTH = 16;

/** A typed or pasted code as the server compares it: letter case, spaces (a trailing newline too) and dashes dropped. */
export function cleanRecoveryCode(text: string) {
  return text.replace(/[\s-]/g, '').toUpperCase();
}

/** AC 8: 16 characters of the alphabet once cleaned. */
export function recoveryCodeReady(text: string) {
  const code = cleanRecoveryCode(text);
  return code.length === RECOVERY_CODE_LENGTH && [...code].every((c) => RECOVERY_ALPHABET.includes(c));
}

/** Monospaced text for the code on iOS and Android (edge case). */
export const CODE_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const en = (id: Parameters<typeof translate>[1]) => translate('en', id);
/** AC 10: the same whether or not the username exists. */
export const RECOVERY_WRONG = en('forgot.wrong');
/** AC 11. */
export const RECOVERY_LOCKED = en('forgot.locked');
/** Edge case (two devices): Continue on an older code shows a fresh one with this message. */
export const RECOVERY_REPLACED = en('recovery.replaced');
/** AC 9: the sign-in screen's notice on another device after a recovery. */
export const PASSWORD_CHANGED_SIGNED_OUT = en('signIn.passwordChangedSignedOut');

/** Thrown by the store's saveRecoveryCode when the code shown isn't the current one any more (another device made a
 *  newer one): `fresh` is the new code to show instead ('' when none could be made). */
export class RecoveryCodeReplaced extends Error {
  constructor(public fresh: string) {
    super(RECOVERY_REPLACED);
  }
}
