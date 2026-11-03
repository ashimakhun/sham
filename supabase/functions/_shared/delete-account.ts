// ARU-75: the delete-account Edge Function's logic. The app calls it with the signed-in user's access token
// ("Authorization: Bearer <jwt>") and {"password": "..."}. It only ever deletes the caller, in this order (AC 12):
//   a. checks: the token's user, the password, then account_deletion_problem() (teacher, course owner). If any fails,
//      nothing is touched and the matching message is returned.
//   b. files: every Storage object of the account (account_storage_objects(): its homework/<id>/… and
//      materials/<id>/… folders and anything it owns) is removed through the Storage API. A failure stops here: the
//      account stays and a retry continues.
//   c. the Auth user is deleted. The database removes the profile and all personal rows and clears the shared
//      references in one transaction (migration 0040), so this step is all-or-nothing. Supabase refuses to delete a
//      user who still owns Storage objects (e.g. a file uploaded from another device after b): the step fails, and a
//      retry removes that file too.
// No Deno-only imports, so Jest can test it.

/** The messages the app shows as they are (AC 3, 6, 12). */
export const WRONG_PASSWORD = 'Password is incorrect';
export const DELETE_FAILED = "Your account couldn't be deleted. Please try again.";
export const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait a minute and try again.';

export type StorageObject = { bucket_id: string; name: string };

export type DeleteAccountDeps = {
  /** The user the access token belongs to (auth.getUser(jwt) with the service role); null for a bad or expired token
   *  or a user that no longer exists. Throws on other errors. */
  userFromToken: (jwt: string) => Promise<{ id: string; email: string | null } | null>;
  /** Signs in with email and password on a separate, non-persisted client: 'ok', 'wrong', or 'rate_limited'.
   *  Throws on other errors. */
  checkPassword: (email: string, password: string) => Promise<'ok' | 'wrong' | 'rate_limited'>;
  /** account_deletion_problem(user): why the account can't be deleted, or null. Throws on a database error. */
  problem: (userId: string) => Promise<string | null>;
  /** account_storage_objects(user). Throws on a database error. */
  storageObjects: (userId: string) => Promise<StorageObject[]>;
  /** Removes these objects of one bucket through the Storage API. Throws on failure. */
  removeObjects: (bucket: string, names: string[]) => Promise<void>;
  /** auth.admin.deleteUser(user). Throws on failure. */
  deleteUser: (userId: string) => Promise<void>;
  log?: (line: string) => void;
};

export type DeleteAccountResult =
  | { deleted: true; files: number }
  | { error: string; code: 'unauthorized' | 'bad_request' | 'wrong_password' | 'not_allowed' | 'rate_limited' | 'failed'; step?: 'check' | 'files' | 'account' };

/** The Storage API removes at most this many objects per call. */
export const REMOVE_BATCH = 100;

// The app also runs on the web, so the browser's preflight must pass.
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (body: DeleteAccountResult | { error: string }, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Groups objects by bucket, in batches the Storage API accepts. */
export function removalBatches(objects: StorageObject[], size = REMOVE_BATCH): { bucket: string; names: string[] }[] {
  const byBucket = new Map<string, string[]>();
  for (const o of objects) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o.name]);
  const batches: { bucket: string; names: string[] }[] = [];
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += size) batches.push({ bucket, names: names.slice(i, i + size) });
  }
  return batches;
}

/**
 * The function. 401 without a valid user token; 400 without a password; 403 for a wrong password, the teacher or a
 * course owner; 429 when Auth rate-limits the password check; 500 when a step fails (with `step`); 200 when deleted.
 * The body's `user`, `email` or `id` fields are ignored: only the token's user is ever affected.
 */
export async function handleDeleteAccountRequest(request: Request, deps: DeleteAccountDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = request.headers.get('authorization') ?? '';
  const jwt = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (!jwt) return json({ error: 'Not signed in.', code: 'unauthorized' }, 401);

  let password: unknown;
  try {
    password = ((await request.json()) as { password?: unknown } | null)?.password;
  } catch {
    password = undefined;
  }
  if (typeof password !== 'string' || password.length === 0) {
    return json({ error: 'Enter your password.', code: 'bad_request' }, 400);
  }

  // a. Checks: nothing is touched until all pass.
  let user: { id: string; email: string | null } | null;
  try {
    user = await deps.userFromToken(jwt);
  } catch (e) {
    deps.log?.(`delete-account: token check failed: ${message(e)}`);
    return json({ error: DELETE_FAILED, code: 'failed', step: 'check' }, 500);
  }
  if (!user) return json({ error: 'Not signed in.', code: 'unauthorized' }, 401);
  if (!user.email) {
    deps.log?.(`delete-account: ${user.id}: no email, password can't be checked`);
    return json({ error: DELETE_FAILED, code: 'failed', step: 'check' }, 500);
  }

  try {
    const result = await deps.checkPassword(user.email, password);
    if (result === 'wrong') return json({ error: WRONG_PASSWORD, code: 'wrong_password' }, 403);
    if (result === 'rate_limited') return json({ error: TOO_MANY_ATTEMPTS, code: 'rate_limited' }, 429);
  } catch (e) {
    deps.log?.(`delete-account: ${user.id}: password check failed: ${message(e)}`);
    return json({ error: DELETE_FAILED, code: 'failed', step: 'check' }, 500);
  }

  try {
    const problem = await deps.problem(user.id);
    if (problem) return json({ error: problem, code: 'not_allowed' }, 403);
  } catch (e) {
    deps.log?.(`delete-account: ${user.id}: deletion check failed: ${message(e)}`);
    return json({ error: DELETE_FAILED, code: 'failed', step: 'check' }, 500);
  }

  // b. Files.
  let files = 0;
  try {
    const objects = await deps.storageObjects(user.id);
    for (const batch of removalBatches(objects)) {
      await deps.removeObjects(batch.bucket, batch.names);
      files += batch.names.length;
    }
  } catch (e) {
    deps.log?.(`delete-account: ${user.id}: removing files failed after ${files}: ${message(e)}`);
    return json({ error: DELETE_FAILED, code: 'failed', step: 'files' }, 500);
  }

  // c. The account, in one database transaction.
  try {
    await deps.deleteUser(user.id);
  } catch (e) {
    deps.log?.(`delete-account: ${user.id}: deleting the user failed: ${message(e)}`);
    return json({ error: DELETE_FAILED, code: 'failed', step: 'account' }, 500);
  }

  deps.log?.(`delete-account: ${user.id}: deleted (${files} files)`);
  return json({ deleted: true, files }, 200);
}
