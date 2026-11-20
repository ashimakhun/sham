// ARU-165: the logic of the two recovery-code Edge Functions (no Deno-only imports, so Jest can test it).
//
// new-recovery-code (JWT on): the signed-in user's access token and {"password": "..."}. The password is checked on
// the server (a throwaway sign-in, as delete-account does); only then is the code replaced (replace_recovery_code).
// Answers {code} (formatted, unsaved: the app marks it saved with save_recovery_code once the person taps Done).
//
// recover-password (no JWT: callers are signed out): {"username", "code", "password"}. In this order:
//   1. recovery_check(username, code): 'locked' → 429, 'wrong' (counted on the server) → 403, 'ok' → the account.
//   2. the new password through the Auth admin API. Refused (too weak) or failed: nothing changed and the attempt
//      isn't counted (AC 12).
//   3. recovery_finish(account): the used code is deleted, every session ends, the count is reset.
// The app then signs in with the username and the new password.
//
// Wrong answers carry a `code` the app maps to its own texts; the `error` text is English for logs and other callers.

export type RecoveryCheck = { result: 'ok'; userId: string } | { result: 'wrong' | 'locked' };
export type SetPasswordResult = 'ok' | { weak: string };

export type RecoverPasswordDeps = {
  /** recovery_check() with the service role. Throws on a database error. */
  check: (username: string, code: string) => Promise<RecoveryCheck>;
  /** auth.admin.updateUserById(id, { password }). { weak } when Auth refuses the password; throws on other errors. */
  setPassword: (userId: string, password: string) => Promise<SetPasswordResult>;
  /** recovery_finish(). Throws on a database error. */
  finish: (userId: string) => Promise<void>;
  log?: (line: string) => void;
};

export type NewRecoveryCodeDeps = {
  /** As delete-account: the token's user, null for a bad or expired token. Throws on other errors. */
  userFromToken: (jwt: string) => Promise<{ id: string; email: string | null } | null>;
  /** As delete-account: 'ok', 'wrong' or 'rate_limited'. Throws on other errors. */
  checkPassword: (email: string, password: string) => Promise<'ok' | 'wrong' | 'rate_limited'>;
  /** replace_recovery_code(): the new code. Throws on a database error. */
  replaceCode: (userId: string) => Promise<string>;
  log?: (line: string) => void;
};

export type RecoveryErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'wrong_code'
  | 'locked'
  | 'weak_password'
  | 'wrong_password'
  | 'rate_limited'
  | 'failed';

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } });
const fail = (code: RecoveryErrorCode, error: string, status: number) => json({ error, code }, status);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleRecoverPasswordRequest(request: Request, deps: RecoverPasswordDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { username, code, password } = await body(request);
  if (typeof username !== 'string' || !username.trim() || typeof code !== 'string' || !code.trim()) {
    return fail('bad_request', 'Enter your username and recovery code.', 400);
  }
  if (typeof password !== 'string' || password.length === 0) {
    return fail('bad_request', 'Enter a new password.', 400);
  }

  let checked: RecoveryCheck;
  try {
    checked = await deps.check(username, code);
  } catch (e) {
    deps.log?.(`recover-password: check failed: ${message(e)}`);
    return fail('failed', 'Something went wrong. Please try again.', 500);
  }
  if (checked.result === 'locked') return fail('locked', 'Too many attempts. Try again in 15 minutes.', 429);
  if (checked.result !== 'ok') return fail('wrong_code', 'Incorrect username or recovery code.', 403);

  try {
    const set = await deps.setPassword(checked.userId, password);
    if (set !== 'ok') return fail('weak_password', set.weak, 422);
  } catch (e) {
    deps.log?.(`recover-password: ${checked.userId}: setting the password failed: ${message(e)}`);
    return fail('failed', 'Something went wrong. Please try again.', 500);
  }

  try {
    await deps.finish(checked.userId);
  } catch (e) {
    // The password is changed; the code still works, so a retry with it finishes the job.
    deps.log?.(`recover-password: ${checked.userId}: finishing failed: ${message(e)}`);
    return fail('failed', 'Something went wrong. Please try again.', 500);
  }
  deps.log?.(`recover-password: ${checked.userId}: password set, sessions ended`);
  return json({ ok: true }, 200);
}

export async function handleNewRecoveryCodeRequest(request: Request, deps: NewRecoveryCodeDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const jwt = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!jwt) return fail('unauthorized', 'Not signed in.', 401);
  const { password } = await body(request);
  if (typeof password !== 'string' || password.length === 0) {
    return fail('bad_request', 'Enter your current password.', 400);
  }

  let user: { id: string; email: string | null } | null;
  try {
    user = await deps.userFromToken(jwt);
  } catch (e) {
    deps.log?.(`new-recovery-code: token check failed: ${message(e)}`);
    return fail('failed', 'Something went wrong. Please try again.', 500);
  }
  if (!user) return fail('unauthorized', 'Not signed in.', 401);
  if (!user.email) return fail('failed', 'Something went wrong. Please try again.', 500);

  try {
    const result = await deps.checkPassword(user.email, password);
    if (result === 'wrong') return fail('wrong_password', 'Current password is incorrect', 403);
    if (result === 'rate_limited') return fail('rate_limited', 'Too many requests. Please wait a few minutes and try again.', 429);
  } catch (e) {
    deps.log?.(`new-recovery-code: ${user.id}: password check failed: ${message(e)}`);
    return fail('failed', 'Something went wrong. Please try again.', 500);
  }

  try {
    const code = await deps.replaceCode(user.id);
    return json({ code }, 200);
  } catch (e) {
    deps.log?.(`new-recovery-code: ${user.id}: replacing the code failed: ${message(e)}`);
    return fail('failed', 'Something went wrong. Please try again.', 500);
  }
}
