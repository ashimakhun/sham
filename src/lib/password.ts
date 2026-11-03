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

/** A user-readable message for an Auth error: the server's own text, except for the cases the app words itself. */
export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.code === 'same_password') return SAME_PASSWORD;
  if (isRateLimited(error)) return RATE_LIMITED;
  // No answer from the server (offline, timeout): supabase-js reports a retryable fetch error with status 0.
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) return NETWORK_ERROR;
  return error.message || 'Something went wrong. Please try again.';
}
