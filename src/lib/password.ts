// Shared rules and messages for the password screens: change password on Profile (ARU-76) and the forgotten-password
// reset on the sign-in screen (ARU-77), so both behave and read the same. ARU-108: the texts are the English catalog's
// (src/i18n/en.json); the screens show them in the chosen language with translateMessage().
import { translate } from '@/i18n';

const en = (id: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate('en', id, params);

/** The minimum Sham asks for at sign-up; Supabase Auth may be set stricter (its message is shown then). */
export const PASSWORD_MIN = 6;
export const PASSWORD_PLACEHOLDER = en('password.placeholder', { min: PASSWORD_MIN });
export const PASSWORDS_DONT_MATCH = en('password.mismatch');
export const SAME_PASSWORD = en('auth.samePassword');
export const WRONG_CURRENT_PASSWORD = en('auth.wrongCurrentPassword');
export const PASSWORD_CHANGED = en('password.changed');
export const NETWORK_ERROR = en('auth.network');
export const RATE_LIMITED = en('auth.rateLimited');
// ARU-108 AC 7a: Auth errors the app words itself.
export const INVALID_CREDENTIALS = en('auth.invalidCredentials');
export const USER_EXISTS = en('auth.userExists');
export const EMAIL_NOT_CONFIRMED = en('auth.emailNotConfirmed');
// ARU-146: a wrong invite code at sign-up.
export const INVITE_CODE_UNKNOWN = en('auth.inviteCodeUnknown');
/** The server's minimum length when it states one ("Password should be at least 8 characters."), else ours. The
 *  analysis note on ARU-108: a stricter project setting must not be contradicted by "at least 6". */
export const weakPasswordMessage = (serverText?: string) =>
  en('auth.weakPassword', { min: Number(/at least (\d+)/i.exec(serverText ?? '')?.[1] ?? PASSWORD_MIN) });
export const GENERIC_ERROR = en('common.genericError');

// ARU-77: the forgotten-password reset with a code from the email.
export const CODE_INVALID = en('auth.codeInvalid');
/** Seconds before "Send a new code" can be tapped again. */
export const RESEND_COOLDOWN_S = 60;
/** The same answer whether or not an account exists for the email (AC 3). */
export const codeSentMessage = (email: string) => en('reset.codeSent', { email });
/** Digits only: letters are dropped and a pasted "123 456" becomes "123456". */
export const cleanCode = (text: string) => text.replace(/\D/g, '').slice(0, 10);
/** A complete code: 6–10 digits (the project's OTP length, 6 by default). */
export const codeReady = (code: string) => /^\d{6,10}$/.test(code);

/** Both new-password fields are filled and differ (shows "Passwords don't match"). */
export function passwordsMismatch(password: string, confirm: string) {
  return password.length > 0 && confirm.length > 0 && password !== confirm;
}

/** A new password the app accepts: long enough and confirmed. Passwords are never trimmed. */
export function newPasswordReady(password: string, confirm: string) {
  return password.length >= PASSWORD_MIN && password === confirm;
}

/** An error as Supabase Auth returns it (AuthError and its subclasses). */
export type AuthErrorLike = { message?: string; code?: string; status?: number; name?: string } | null | undefined;

/** Sign-in refused because the email and password don't match (not a network, server or rate-limit error). */
export function isInvalidCredentials(error: AuthErrorLike) {
  if (!error) return false;
  if (error.code) return error.code === 'invalid_credentials';
  return error.status === 400 && /invalid login credentials/i.test(error.message ?? '');
}

/** Too many requests (Supabase's rate limits, ARU-77 AC 9). */
export function isRateLimited(error: AuthErrorLike) {
  return !!error && (error.status === 429 || /^over_.*rate_limit$/.test(error.code ?? ''));
}

/** No answer from the server (offline, timeout): supabase-js reports a retryable fetch error with status 0. */
export function isNetworkError(error: AuthErrorLike) {
  return !!error && (error.name === 'AuthRetryableFetchError' || error.status === 0);
}

/** verifyOtp refused the code: wrong, already used or expired. Network and rate-limit errors keep their own text. */
export function codeErrorMessage(error: AuthErrorLike) {
  if (isRateLimited(error) || isNetworkError(error)) return authErrorMessage(error);
  return CODE_INVALID;
}

/** ARU-146: the database refused the new account inside the sign-up (handle_new_user() raised). Supabase Auth answers
 *  500 "Database error saving new user" (code unexpected_failure) and the sham: hint doesn't reach the app. */
export function isSignUpRefusedByDatabase(error: AuthErrorLike) {
  if (!error || isNetworkError(error) || isRateLimited(error)) return false;
  return /database error saving new user/i.test(error.message ?? '') || (error.status === 500 && error.code === 'unexpected_failure');
}

/** A user-readable message for an Auth error: the server's own text, except for the cases the app words itself
 *  (ARU-108 AC 7a). The screens translate the app's texts; any other text becomes the generic one in Russian. */
export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) return GENERIC_ERROR;
  if (error.code === 'same_password') return SAME_PASSWORD;
  if (isInvalidCredentials(error)) return INVALID_CREDENTIALS;
  if (error.code === 'user_already_exists' || error.code === 'email_exists') return USER_EXISTS;
  if (error.code === 'email_not_confirmed') return EMAIL_NOT_CONFIRMED;
  if (error.code === 'weak_password') return weakPasswordMessage(error.message);
  if (isRateLimited(error)) return RATE_LIMITED;
  if (isNetworkError(error)) return NETWORK_ERROR;
  return error.message || GENERIC_ERROR;
}
