/**
 * @jest-environment node
 */
// ARU-75: the delete-account function's logic with Supabase mocked: who may call it, the order of the steps and what
// each failure leaves behind (AC 3, 4, 6, 12, Roles and access).
import {
  DELETE_FAILED,
  type DeleteAccountDeps,
  handleDeleteAccountRequest,
  removalBatches,
  type StorageObject,
  TOO_MANY_ATTEMPTS,
  WRONG_PASSWORD,
} from './delete-account';

const ME = { id: 'u-me', email: 'me@x.test' };
const OWNED = 'You own courses: Algebra. Ask the teacher or a mentor to change their owner first.';

const post = (body: unknown = { password: 'secret1' }, headers: Record<string, string> = { authorization: 'Bearer jwt-me' }, method = 'POST') =>
  new Request('https://x.supabase.co/functions/v1/delete-account', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' || method === 'OPTIONS' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

function deps(over: Partial<DeleteAccountDeps> = {}, objects: StorageObject[] = []) {
  const calls: string[] = [];
  const d: DeleteAccountDeps = {
    userFromToken: jest.fn(async (jwt: string) => {
      calls.push(`token:${jwt}`);
      return jwt === 'jwt-me' ? ME : null;
    }),
    checkPassword: jest.fn(async (email: string, password: string) => {
      calls.push(`password:${email}`);
      return password === 'secret1' ? ('ok' as const) : ('wrong' as const);
    }),
    problem: jest.fn(async (id: string) => {
      calls.push(`problem:${id}`);
      return null;
    }),
    storageObjects: jest.fn(async (id: string) => {
      calls.push(`objects:${id}`);
      return objects;
    }),
    removeObjects: jest.fn(async (bucket: string, names: string[]) => {
      calls.push(`remove:${bucket}:${names.join(',')}`);
    }),
    deleteUser: jest.fn(async (id: string) => {
      calls.push(`delete:${id}`);
    }),
    log: () => {},
    ...over,
  };
  return { d, calls };
}

const files: StorageObject[] = [
  { bucket_id: 'homework', name: 'u-me/h1.jpg' },
  { bucket_id: 'homework', name: 'u-me/h2.jpg' },
  { bucket_id: 'materials', name: 'u-me/p1.pdf' },
];

it('AC4 / AC12: checks, then files, then the account; 200 when deleted', async () => {
  const { d, calls } = deps({}, files);
  const res = await handleDeleteAccountRequest(post(), d);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: true, files: 3 });
  expect(calls).toEqual([
    'token:jwt-me',
    'password:me@x.test',
    'problem:u-me',
    'objects:u-me',
    'remove:homework:u-me/h1.jpg,u-me/h2.jpg',
    'remove:materials:u-me/p1.pdf',
    'delete:u-me',
  ]);
});

it('only the token\'s user is ever deleted: ids or emails in the body are ignored', async () => {
  const { d, calls } = deps();
  await handleDeleteAccountRequest(post({ password: 'secret1', user_id: 'u-other', id: 'u-other', email: 'o@x.test' }), d);
  expect(calls.filter((c) => c.includes('other') || c.includes('o@x.test'))).toEqual([]);
  expect(d.deleteUser).toHaveBeenCalledWith('u-me');
});

describe('a: checks first, nothing touched when one fails', () => {
  const untouched = (d: DeleteAccountDeps) => {
    expect(d.storageObjects).not.toHaveBeenCalled();
    expect(d.removeObjects).not.toHaveBeenCalled();
    expect(d.deleteUser).not.toHaveBeenCalled();
  };

  it.each([
    ['no Authorization header', {}],
    ['not a Bearer token', { authorization: 'jwt-me' }],
    ['an unknown or expired token (or a user that is gone)', { authorization: 'Bearer jwt-other' }],
  ])('%s: 401', async (_name, headers) => {
    const { d } = deps();
    const res = await handleDeleteAccountRequest(post(undefined, headers), d);
    expect(res.status).toBe(401);
    expect(d.checkPassword).not.toHaveBeenCalled();
    untouched(d);
  });

  it.each([
    ['no password', {}],
    ['an empty password', { password: '' }],
    ['a password that is not text', { password: 123 }],
    ['a body that is not JSON', 'nope'],
  ])('%s: 400', async (_name, body) => {
    const { d } = deps();
    const res = await handleDeleteAccountRequest(post(body), d);
    expect(res.status).toBe(400);
    untouched(d);
  });

  it('AC3 a wrong password: 403 "Password is incorrect"', async () => {
    const { d } = deps();
    const res = await handleDeleteAccountRequest(post({ password: 'wrong!' }), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: WRONG_PASSWORD, code: 'wrong_password' });
    expect(d.problem).not.toHaveBeenCalled();
    untouched(d);
  });

  it('too many password attempts: 429 with a readable message', async () => {
    const { d } = deps({ checkPassword: jest.fn(async () => 'rate_limited' as const) });
    const res = await handleDeleteAccountRequest(post(), d);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(TOO_MANY_ATTEMPTS);
    untouched(d);
  });

  it('AC6 a course owner: 403 with the course list', async () => {
    const { d } = deps({ problem: jest.fn(async () => OWNED) });
    const res = await handleDeleteAccountRequest(post(), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: OWNED, code: 'not_allowed' });
    untouched(d);
  });

  it('the teacher: 403', async () => {
    const { d } = deps({ problem: jest.fn(async () => "The teacher's account can't be deleted.") });
    const res = await handleDeleteAccountRequest(post(), d);
    expect(res.status).toBe(403);
    untouched(d);
  });

  it.each([
    ['the token check', { userFromToken: jest.fn(async () => Promise.reject(new Error('auth down'))) }],
    ['the password check', { checkPassword: jest.fn(async () => Promise.reject(new Error('auth down'))) }],
    ['the deletion check', { problem: jest.fn(async () => Promise.reject(new Error('db down'))) }],
  ])('%s failing: 500, step "check"', async (_name, over) => {
    const { d } = deps(over as Partial<DeleteAccountDeps>);
    const res = await handleDeleteAccountRequest(post(), d);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: DELETE_FAILED, code: 'failed', step: 'check' });
    untouched(d);
  });

  it('a user without an email: 500, nothing touched', async () => {
    const { d } = deps({ userFromToken: jest.fn(async () => ({ id: 'u-me', email: null })) });
    const res = await handleDeleteAccountRequest(post(), d);
    expect(res.status).toBe(500);
    untouched(d);
  });
});

it('AC12b a file removal failing part-way: 500 step "files", the account is not deleted; a retry finishes', async () => {
  let failOnce = true;
  const removeObjects = jest.fn(async (bucket: string) => {
    if (bucket === 'materials' && failOnce) {
      failOnce = false;
      throw new Error('storage down');
    }
  });
  const { d } = deps({ removeObjects }, files);
  const res = await handleDeleteAccountRequest(post(), d);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: DELETE_FAILED, code: 'failed', step: 'files' });
  expect(d.deleteUser).not.toHaveBeenCalled();

  const retry = await handleDeleteAccountRequest(post(), d);
  expect(retry.status).toBe(200);
  expect(d.deleteUser).toHaveBeenCalledTimes(1);
});

it('AC12c deleting the user failing (e.g. a file uploaded meanwhile): 500 step "account"', async () => {
  const { d } = deps({ deleteUser: jest.fn(async () => Promise.reject(new Error('user owns storage objects'))) }, files);
  const res = await handleDeleteAccountRequest(post(), d);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: DELETE_FAILED, code: 'failed', step: 'account' });
});

it('listing the files failing: 500 step "files", nothing removed or deleted', async () => {
  const { d } = deps({ storageObjects: jest.fn(async () => Promise.reject(new Error('db down'))) });
  const res = await handleDeleteAccountRequest(post(), d);
  expect(res.status).toBe(500);
  expect(d.removeObjects).not.toHaveBeenCalled();
  expect(d.deleteUser).not.toHaveBeenCalled();
});

it('no files: goes straight to the account', async () => {
  const { d } = deps();
  const res = await handleDeleteAccountRequest(post(), d);
  expect(res.status).toBe(200);
  expect(d.removeObjects).not.toHaveBeenCalled();
});

it('other methods: 405; the browser preflight (web) passes', async () => {
  const { d } = deps();
  expect((await handleDeleteAccountRequest(post(undefined, undefined, 'GET'), d)).status).toBe(405);
  const pre = await handleDeleteAccountRequest(post(undefined, undefined, 'OPTIONS'), d);
  expect(pre.status).toBe(200);
  expect(pre.headers.get('access-control-allow-headers')).toMatch(/authorization/);
  expect(d.userFromToken).not.toHaveBeenCalled();
});

it('removalBatches groups by bucket in batches', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ bucket_id: 'homework', name: `u/${i}.jpg` }));
  expect(removalBatches([...many, { bucket_id: 'materials', name: 'u/p.pdf' }], 2)).toEqual([
    { bucket: 'homework', names: ['u/0.jpg', 'u/1.jpg'] },
    { bucket: 'homework', names: ['u/2.jpg', 'u/3.jpg'] },
    { bucket: 'homework', names: ['u/4.jpg'] },
    { bucket: 'materials', names: ['u/p.pdf'] },
  ]);
});
