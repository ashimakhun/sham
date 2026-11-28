/**
 * @jest-environment node
 */
// ARU-180: the delete-account function's workspace deletion with Supabase mocked: only the teacher, the order of the
// checks, files before the one database step, and what each failure leaves behind (AC 3, 4, 5, 11, 12, Roles and
// access).
import {
  type DeleteAccountDeps,
  handleDeleteAccountRequest,
  type StorageObject,
  TOO_MANY_ATTEMPTS,
  WORKSPACE_DELETE_FAILED,
  WORKSPACE_NAME_MISMATCH,
  WORKSPACE_NAME_MISSING,
  WORKSPACE_TEACHER_ONLY,
  workspaceNameMatches,
  WRONG_PASSWORD,
} from './delete-account';

const TEACHER = { id: 'u-t', email: 't@x.test' };
const STUDENT = { id: 'u-s', email: 's@x.test' };
const TARGET = { workspaceId: 'ws-1', name: 'Sunny School', otherAccounts: 5 };

const post = (body: unknown, jwt = 'jwt-t') =>
  new Request('https://x.supabase.co/functions/v1/delete-account', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });

const files: StorageObject[] = [
  { bucket_id: 'homework', name: 'u-s/h1.jpg' },
  { bucket_id: 'materials', name: 'u-m/p1.pdf' },
  { bucket_id: 'payment-proofs', name: 'u-s/proof.jpg' },
];

function deps(over: Partial<DeleteAccountDeps> = {}) {
  const calls: string[] = [];
  const d: DeleteAccountDeps = {
    userFromToken: jest.fn(async (jwt: string) => {
      calls.push(`token:${jwt}`);
      return jwt === 'jwt-t' ? TEACHER : jwt === 'jwt-s' ? STUDENT : null;
    }),
    checkPassword: jest.fn(async (email: string, password: string) => {
      calls.push(`password:${email}`);
      return password === 'secret1' ? ('ok' as const) : ('wrong' as const);
    }),
    problem: jest.fn(async (id: string) => {
      calls.push(`problem:${id}`);
      return id === TEACHER.id ? "The teacher's account can't be deleted." : null;
    }),
    storageObjects: jest.fn(async (id: string) => {
      calls.push(`objects:${id}`);
      return [];
    }),
    removeObjects: jest.fn(async (bucket: string, names: string[]) => {
      calls.push(`remove:${bucket}:${names.join(',')}`);
    }),
    deleteUser: jest.fn(async (id: string) => {
      calls.push(`deleteUser:${id}`);
    }),
    workspaceTarget: jest.fn(async (id: string) => {
      calls.push(`target:${id}`);
      return id === TEACHER.id ? TARGET : null;
    }),
    workspaceStorageObjects: jest.fn(async (ws: string) => {
      calls.push(`wsObjects:${ws}`);
      return files;
    }),
    deleteWorkspace: jest.fn(async (id: string) => {
      calls.push(`deleteWorkspace:${id}`);
    }),
    log: () => {},
    ...over,
  };
  return { d, calls };
}

const bodyOf = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe('AC 3: the workspace name', () => {
  it.each([
    ['Sunny School', true],
    ['  sunny SCHOOL ', true],
    ['SUNNY SCHOOL', true],
    ['Sunny  School', false],
    ['Sunny Schoo', false],
    ['', false],
    ['   ', false],
  ])('"%s" matches: %s', (typed, ok) => {
    expect(workspaceNameMatches(typed, 'Sunny School')).toBe(ok);
  });
  it('compares Cyrillic names without case', () => {
    expect(workspaceNameMatches(' школа Солнце', 'Школа солнце ')).toBe(true);
  });
});

describe('AC 5 / AC 11: the order of the steps', () => {
  it('checks the teacher, the password and the name, removes every file, then makes one database call', async () => {
    const { d, calls } = deps();
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: ' sunny school ' }), d);
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ deleted: true, files: 3, workspace: true });
    expect(calls).toEqual([
      'token:jwt-t',
      'target:u-t',
      'password:t@x.test',
      'wsObjects:ws-1',
      'remove:homework:u-s/h1.jpg',
      'remove:materials:u-m/p1.pdf',
      'remove:payment-proofs:u-s/proof.jpg',
      'deleteWorkspace:u-t',
    ]);
  });
  it('never calls auth.admin.deleteUser() or the ARU-75 checks for the teacher', async () => {
    const { d } = deps();
    await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny School' }), d);
    expect(d.deleteUser).not.toHaveBeenCalled();
    expect(d.problem).not.toHaveBeenCalled();
    expect(d.storageObjects).not.toHaveBeenCalled();
  });
});

describe('checks: nothing is touched', () => {
  const untouched = (d: DeleteAccountDeps) => {
    expect(d.workspaceStorageObjects).not.toHaveBeenCalled();
    expect(d.removeObjects).not.toHaveBeenCalled();
    expect(d.deleteWorkspace).not.toHaveBeenCalled();
    expect(d.deleteUser).not.toHaveBeenCalled();
  };
  it('AC 4: a wrong password', async () => {
    const { d } = deps();
    const res = await handleDeleteAccountRequest(post({ password: 'nope', workspace_name: 'Sunny School' }), d);
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toBe(WRONG_PASSWORD);
    untouched(d);
  });
  it('a name that doesn’t match', async () => {
    const { d } = deps();
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny' }), d);
    expect(res.status).toBe(403);
    expect(await bodyOf(res)).toEqual({ error: WORKSPACE_NAME_MISMATCH, code: 'name_mismatch' });
    untouched(d);
  });
  it('an empty name', async () => {
    const { d } = deps();
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: '  ' }), d);
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe(WORKSPACE_NAME_MISSING);
    untouched(d);
  });
  it('a name that isn’t text', async () => {
    const { d } = deps();
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 42 }), d);
    expect(res.status).toBe(400);
    untouched(d);
  });
  it('Roles and access: a student or mentor sending a workspace name', async () => {
    const { d, calls } = deps();
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny School' }, 'jwt-s'), d);
    expect(res.status).toBe(403);
    expect(await bodyOf(res)).toEqual({ error: WORKSPACE_TEACHER_ONLY, code: 'not_allowed' });
    expect(calls).toEqual(['token:jwt-s', 'target:u-s']);
    untouched(d);
  });
  it('Roles and access: signed out', async () => {
    const { d } = deps();
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny School' }, 'bad'), d);
    expect(res.status).toBe(401);
    untouched(d);
  });
  it('a rate-limited password check', async () => {
    const { d } = deps({ checkPassword: jest.fn(async () => 'rate_limited' as const) });
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny School' }), d);
    expect(res.status).toBe(429);
    expect((await bodyOf(res)).error).toBe(TOO_MANY_ATTEMPTS);
    untouched(d);
  });
  it('a failing teacher check', async () => {
    const { d } = deps({ workspaceTarget: jest.fn(async () => Promise.reject(new Error('db down'))) });
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny School' }), d);
    expect(res.status).toBe(500);
    expect(await bodyOf(res)).toEqual({ error: WORKSPACE_DELETE_FAILED, code: 'failed', step: 'check' });
    untouched(d);
  });
  it('ARU-75 unchanged: the teacher without a workspace name is refused', async () => {
    const { d } = deps();
    const res = await handleDeleteAccountRequest(post({ password: 'secret1' }), d);
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toBe("The teacher's account can't be deleted.");
    untouched(d);
  });
});

describe('AC 11 / AC 12: failures', () => {
  it('a file removal failing part-way stops before the database', async () => {
    const remove = jest.fn(async (bucket: string) => {
      if (bucket === 'materials') throw new Error('storage down');
    });
    const { d } = deps({ removeObjects: remove });
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny School' }), d);
    expect(res.status).toBe(500);
    expect(await bodyOf(res)).toEqual({ error: WORKSPACE_DELETE_FAILED, code: 'failed', step: 'files' });
    expect(d.deleteWorkspace).not.toHaveBeenCalled();
  });
  it('the database step failing (e.g. a late upload) shows the error; a retry runs every step again', async () => {
    let attempt = 0;
    const { d } = deps({
      deleteWorkspace: jest.fn(async () => {
        attempt++;
        if (attempt === 1) throw new Error('Some files are still being removed. Please try again.');
      }),
    });
    const first = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny School' }), d);
    expect(first.status).toBe(500);
    expect(await bodyOf(first)).toEqual({ error: WORKSPACE_DELETE_FAILED, code: 'failed', step: 'workspace' });
    const second = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny School' }), d);
    expect(second.status).toBe(200);
    expect(d.workspaceStorageObjects).toHaveBeenCalledTimes(2);
  });
  it('a function deployed without the workspace steps fails safely', async () => {
    const { d } = deps({ workspaceTarget: undefined });
    const res = await handleDeleteAccountRequest(post({ password: 'secret1', workspace_name: 'Sunny School' }), d);
    expect(res.status).toBe(500);
    expect(d.deleteUser).not.toHaveBeenCalled();
  });
});
