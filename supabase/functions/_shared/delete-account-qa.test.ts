/**
 * @jest-environment node
 */
// QA ARU-75: gaps in delete-account.test.ts: odd Authorization headers, odd bodies, a password made of spaces going
// to the password check (not trimmed), the order of the checks (a course owner with a wrong password hears about the
// password), the password never logged, many files across buckets removed in batches before the account, and the
// error bodies the app reads.
import { type DeleteAccountDeps, handleDeleteAccountRequest, REMOVE_BATCH, type StorageObject, WRONG_PASSWORD } from './delete-account';

const ME = { id: 'u-me', email: 'me@x.test' };
const URL_ = 'https://x.supabase.co/functions/v1/delete-account';
const req = (body: string | undefined, headers: Record<string, string> = { authorization: 'Bearer jwt-me' }) =>
  new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

function deps(over: Partial<DeleteAccountDeps> = {}, objects: StorageObject[] = []) {
  const calls: string[] = [];
  const logs: string[] = [];
  const d: DeleteAccountDeps = {
    userFromToken: jest.fn(async (jwt: string) => (jwt === 'jwt-me' ? ME : null)),
    checkPassword: jest.fn(async (_e: string, p: string) => (p === 'secret1' ? ('ok' as const) : ('wrong' as const))),
    problem: jest.fn(async () => null),
    storageObjects: jest.fn(async () => objects),
    removeObjects: jest.fn(async (bucket: string, names: string[]) => {
      calls.push(`remove:${bucket}:${names.length}`);
    }),
    deleteUser: jest.fn(async (id: string) => {
      calls.push(`delete:${id}`);
    }),
    log: (line) => logs.push(line),
    ...over,
  };
  return { d, calls, logs };
}

it.each([
  ['Basic auth', { authorization: 'Basic dXNlcjpwYXNz' }],
  ['"Bearer" with no token', { authorization: 'Bearer ' }],
  ['two tokens', { authorization: 'Bearer jwt-me extra' }],
  ['the token in another header', { 'x-access-token': 'jwt-me' }],
])('%s: 401, nothing looked up or deleted', async (_k, headers) => {
  const { d } = deps();
  const res = await handleDeleteAccountRequest(req(JSON.stringify({ password: 'secret1' }), headers), d);
  expect(res.status).toBe(401);
  expect(d.checkPassword).not.toHaveBeenCalled();
  expect(d.deleteUser).not.toHaveBeenCalled();
});

it('an expired or another user\'s token (no user) gets 401 even with the right password', async () => {
  const { d } = deps();
  const res = await handleDeleteAccountRequest(req(JSON.stringify({ password: 'secret1' }), { authorization: 'Bearer jwt-other' }), d);
  expect(res.status).toBe(401);
  expect(d.deleteUser).not.toHaveBeenCalled();
});

it.each([
  ['an array', '["secret1"]'],
  ['null', 'null'],
  ['a number password', JSON.stringify({ password: 123456 })],
  ['an empty password', JSON.stringify({ password: '' })],
  ['malformed JSON', '{"password":'],
  ['no body', undefined],
])('a body of %s: 400, nothing looked up', async (_k, body) => {
  const { d } = deps();
  const res = await handleDeleteAccountRequest(req(body), d);
  expect(res.status).toBe(400);
  expect(d.userFromToken).not.toHaveBeenCalled();
  expect(d.deleteUser).not.toHaveBeenCalled();
});

it('a password of spaces is sent to the password check as typed (not trimmed) and is wrong', async () => {
  const { d } = deps();
  const res = await handleDeleteAccountRequest(req(JSON.stringify({ password: '   ' })), d);
  expect(d.checkPassword).toHaveBeenCalledWith(ME.email, '   ');
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: WRONG_PASSWORD, code: 'wrong_password' });
});

it('AC6 + AC3: a course owner with a wrong password is told about the password; the owner check is not reached', async () => {
  const { d } = deps({ problem: jest.fn(async () => 'You own courses: Algebra. Ask the teacher or a mentor to change their owner first.') });
  const res = await handleDeleteAccountRequest(req(JSON.stringify({ password: 'nope' })), d);
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe(WRONG_PASSWORD);
  expect(d.problem).not.toHaveBeenCalled();
  expect(d.storageObjects).not.toHaveBeenCalled();
});

it('the password never appears in any log line, on success or failure', async () => {
  const secret = 'secret1';
  const ok = deps();
  await handleDeleteAccountRequest(req(JSON.stringify({ password: secret })), ok.d);
  const bad = deps({ checkPassword: jest.fn(async () => { throw new Error('auth down'); }) });
  await handleDeleteAccountRequest(req(JSON.stringify({ password: secret })), bad.d);
  expect([...ok.logs, ...bad.logs].join('\n')).not.toContain(secret);
});

it('AC12b: 250 files in two buckets are removed in batches of at most 100, all before the account', async () => {
  const objects: StorageObject[] = [
    ...Array.from({ length: 230 }, (_, i) => ({ bucket_id: 'homework', name: `u-me/h${i}.jpg` })),
    ...Array.from({ length: 20 }, (_, i) => ({ bucket_id: 'materials', name: `u-me/p${i}.pdf` })),
  ];
  const { d, calls } = deps({}, objects);
  const res = await handleDeleteAccountRequest(req(JSON.stringify({ password: 'secret1' })), d);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: true, files: 250 });
  expect(calls).toEqual(['remove:homework:100', 'remove:homework:100', 'remove:homework:30', 'remove:materials:20', 'delete:u-me']);
  expect(REMOVE_BATCH).toBe(100);
});

it('every error answer is JSON with an "error" string the app can show, and CORS headers', async () => {
  const cases: [DeleteAccountDeps, string | undefined][] = [
    [deps().d, JSON.stringify({ password: 'nope' })],
    [deps().d, JSON.stringify({})],
    [deps({ deleteUser: jest.fn(async () => { throw new Error('x'); }) }).d, JSON.stringify({ password: 'secret1' })],
  ];
  for (const [d, body] of cases) {
    const res = await handleDeleteAccountRequest(req(body), d);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const json = (await res.json()) as { error?: unknown };
    expect(typeof json.error).toBe('string');
    expect((json.error as string).length).toBeGreaterThan(0);
  }
});
