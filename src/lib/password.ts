// Shared rules and messages for the password screens: change password on Profile (ARU-76) and the forgotten-password
// reset on the sign-in screen (ARU-77), so both behave and read the same.

/** The minimum Sham asks for at sign-up; Supabase Auth may be set stricter (its message is shown then). */
export const PASSWORD_MIN = 6;
export const PASSWORD_PLACEHOLDER = `At least ${PASSWORD_MIN} characters`;
export const PASSWORDS_DONT_MATCH = "Passwords don't match";
export const SAME_PASSWORD = 'The new password must be different from the current one';
export const WRONG_CURRENT_PASSWORD = 'Current password is incorrect';
export const PASSWORD_CHANGED = 'Password changed';
export const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';
export const RATE_LIMITED = 'Too many requests. Please wait a few minutes and try again.';

// ARU-77: the forgotten-password reset with a code from the email.
export const CODE_INVALID = 'This code is wrong or has expired. Check the email or send a new code.';
/** Seconds before "Send a new code" can be tapped again. */
export const RESEND_COOLDOWN_S = 60;
/** The same answer whether or not an account exists for the email (AC 3). */
export const codeSentMessage = (email: string) =>
  `If an account exists for ${email}, we've sent a code to it. It can take a few minutes.`;
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

/** A user-readable message for an Auth error: the server's own text, except for the cases the app words itself. */
export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.code === 'same_password') return SAME_PASSWORD;
  if (isRateLimited(error)) return RATE_LIMITED;
  if (isNetworkError(error)) return NETWORK_ERROR;
  return error.message || 'Something went wrong. Please try again.';
}
