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
// ARU-180: the teacher deletes their account together with their workspace. The app then also sends
// {"workspace_name": "..."}; with it, the order is (AC 11):
//   a. checks: the token's user is the teacher of a workspace (workspace_deletion_target()), the password, and the typed
//      name matches the workspace's name (case and outer spaces ignored, AC 3). If any fails, nothing is touched.
//   b. files: every Storage object of the workspace's people (workspace_storage_objects()) is removed. A failure stops
//      here: the account and the workspace stay and a retry continues.
//   c. ONE database call, delete_workspace() (migration 0078): it re-checks the files, deletes the workspace's rows,
//      deactivates the other accounts and deletes the teacher's Auth user, all in one transaction. auth.admin.deleteUser()
//      is never called for the teacher: it would be a second step outside that transaction.
// Without workspace_name a teacher still gets "The teacher's account can't be deleted." (ARU-75), and anyone who
// isn't a teacher sending it gets TEACHER_ONLY: nothing changes.
// No Deno-only imports, so Jest can test it.

/** The messages the app shows as they are (AC 3, 6, 12). */
export const WRONG_PASSWORD = 'Password is incorrect';
export const DELETE_FAILED = "Your account couldn't be deleted. Please try again.";
export const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait a minute and try again.';

/** ARU-180: the workspace deletion's messages (AC 3, 4, 11, 12, Roles and access). */
export const WORKSPACE_TEACHER_ONLY = 'Only the teacher can delete the workspace.';
export const WORKSPACE_NAME_MISMATCH = "The workspace name doesn't match.";
export const WORKSPACE_NAME_MISSING = 'Type the workspace name.';
export const WORKSPACE_DELETE_FAILED = "Your account and workspace couldn't be deleted. Please try again.";

/** AC 3: the typed name matches when it's the same apart from case and leading / trailing spaces. */
export function workspaceNameMatches(typed: string, name: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  return norm(typed).length > 0 && norm(typed) === norm(name);
}

export type StorageObject = { bucket_id: string; name: string };

export type WorkspaceTarget = { workspaceId: string; name: string; otherAccounts: number };

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
  /** ARU-180: workspace_deletion_target(user): the workspace the user is the teacher of, or null. Throws on error. */
  workspaceTarget?: (userId: string) => Promise<WorkspaceTarget | null>;
  /** ARU-180: workspace_storage_objects(workspace). Throws on a database error. */
  workspaceStorageObjects?: (workspaceId: string) => Promise<StorageObject[]>;
  /** ARU-180: delete_workspace(teacher), the one all-or-nothing database step. Throws on failure. */
  deleteWorkspace?: (teacherId: string) => Promise<void>;
  log?: (line: string) => void;
};

export type DeleteAccountResult =
  | { deleted: true; files: number; workspace?: true }
  | { error: string; code: 'unauthorized' | 'bad_request' | 'wrong_password' | 'not_allowed' | 'name_mismatch' | 'rate_limited' | 'failed'; step?: 'check' | 'files' | 'account' | 'workspace' };

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
  let workspaceName: unknown;
  try {
    const body = (await request.json()) as { password?: unknown; workspace_name?: unknown } | null;
    password = body?.password;
    workspaceName = body?.workspace_name;
  } catch {
    password = undefined;
  }
  if (typeof password !== 'string' || password.length === 0) {
    return json({ error: 'Enter your password.', code: 'bad_request' }, 400);
  }
  // ARU-180: the teacher's workspace deletion.
  const deletesWorkspace = workspaceName !== undefined && workspaceName !== null;
  if (deletesWorkspace && (typeof workspaceName !== 'string' || workspaceName.trim().length === 0)) {
    return json({ error: WORKSPACE_NAME_MISSING, code: 'bad_request' }, 400);
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

  if (deletesWorkspace) return deleteWorkspaceSteps(deps, user as { id: string; email: string }, password, workspaceName as string);

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

/** ARU-180: the teacher's account and workspace (see the header). The token's user is already known. */
async function deleteWorkspaceSteps(
  deps: DeleteAccountDeps,
  user: { id: string; email: string },
  password: string,
  typedName: string,
): Promise<Response> {
  const { workspaceTarget, workspaceStorageObjects, deleteWorkspace } = deps;
  if (!workspaceTarget || !workspaceStorageObjects || !deleteWorkspace) {
    deps.log?.(`delete-account: ${user.id}: workspace deletion not configured`);
    return json({ error: WORKSPACE_DELETE_FAILED, code: 'failed', step: 'check' }, 500);
  }

  // a. Checks: the teacher, the password, the name. Nothing is touched until all pass.
  let target: WorkspaceTarget | null;
  try {
    target = await workspaceTarget(user.id);
  } catch (e) {
    deps.log?.(`delete-account: ${user.id}: workspace check failed: ${message(e)}`);
    return json({ error: WORKSPACE_DELETE_FAILED, code: 'failed', step: 'check' }, 500);
  }
  if (!target) return json({ error: WORKSPACE_TEACHER_ONLY, code: 'not_allowed' }, 403);

  try {
    const result = await deps.checkPassword(user.email, password);
    if (result === 'wrong') return json({ error: WRONG_PASSWORD, code: 'wrong_password' }, 403);
    if (result === 'rate_limited') return json({ error: TOO_MANY_ATTEMPTS, code: 'rate_limited' }, 429);
  } catch (e) {
    deps.log?.(`delete-account: ${user.id}: password check failed: ${message(e)}`);
    return json({ error: WORKSPACE_DELETE_FAILED, code: 'failed', step: 'check' }, 500);
  }

  if (!workspaceNameMatches(typedName, target.name)) {
    return json({ error: WORKSPACE_NAME_MISMATCH, code: 'name_mismatch' }, 403);
  }

  // b. Files of everyone in the workspace.
  let files = 0;
  try {
    const objects = await workspaceStorageObjects(target.workspaceId);
    for (const batch of removalBatches(objects)) {
      await deps.removeObjects(batch.bucket, batch.names);
      files += batch.names.length;
    }
  } catch (e) {
    deps.log?.(`delete-account: ${user.id}: removing workspace files failed after ${files}: ${message(e)}`);
    return json({ error: WORKSPACE_DELETE_FAILED, code: 'failed', step: 'files' }, 500);
  }

  // c. One transaction: rows, members, the teacher's Auth user.
  try {
    await deleteWorkspace(user.id);
  } catch (e) {
    deps.log?.(`delete-account: ${user.id}: deleting the workspace failed: ${message(e)}`);
    return json({ error: WORKSPACE_DELETE_FAILED, code: 'failed', step: 'workspace' }, 500);
  }

  deps.log?.(`delete-account: ${user.id}: workspace ${target.workspaceId} deleted (${files} files, ${target.otherAccounts} deactivated)`);
  return json({ deleted: true, files, workspace: true }, 200);
}
