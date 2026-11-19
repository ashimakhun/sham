// ARU-164: sign-up and sign-in with a username instead of an email. Supabase Auth needs an email, so each account gets
// an internal address <username>@USERNAME_DOMAIN that can never receive mail (.invalid, RFC 2606). It is never shown
// in the app and nothing is sent to it. The same domain is in supabase/migrations/0065_username_sign_in.sql: keep both
// in step.

export const USERNAME_DOMAIN = 'users.sham.invalid';
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/** A username as it is saved: trimmed and lower case. */
export function normalizeUsername(text: string) {
  return text.trim().toLowerCase();
}

/** 3–30 characters of a–z 0–9 _ . -, starting and ending with a letter or digit, no "..". Capitals are accepted
 *  (saved in lower case). */
export function isValidUsername(text: string) {
  const name = normalizeUsername(text);
  return /^[a-z0-9][a-z0-9_.-]{1,28}[a-z0-9]$/.test(name) && !name.includes('..');
}

/** The Auth address for a username. */
export function usernameAddress(username: string) {
  return `${normalizeUsername(username)}@${USERNAME_DOMAIN}`;
}

/** What the sign-in field becomes for Auth (analysis note 5): text with "@" is an older account's email (AC 8), used
 *  as typed (trimmed); anything else is a username, lower-cased into its internal address. No sign-up rules here:
 *  Auth's answer decides. */
export function signInAddress(text: string) {
  const value = text.trim();
  return value.includes('@') ? value : usernameAddress(value);
}

/** The username behind an Auth address, or null for an older account's real email (AC 10: nothing is shown). */
export function usernameFromAddress(email: string | null | undefined) {
  const suffix = `@${USERNAME_DOMAIN}`;
  if (!email || !email.toLowerCase().endsWith(suffix)) return null;
  return email.slice(0, -suffix.length).toLowerCase() || null;
}
