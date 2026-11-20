/**
 * @jest-environment node
 */
// ARU-165: the recover-password and new-recovery-code functions' logic with Supabase mocked.
import {
  handleNewRecoveryCodeRequest,
  handleRecoverPasswordRequest,
  type NewRecoveryCodeDeps,
  type RecoverPasswordDeps,
} from './recovery';

const post = (body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
  new Request('https://x.supabase.co/functions/v1/f', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

describe('recover-password', () => {
  function deps(over: Partial<RecoverPasswordDeps> = {}) {
    const calls: string[] = [];
    const d: RecoverPasswordDeps = {
      check: jest.fn(async (u: string, c: string) => {
        calls.push(`check:${u}:${c}`);
        if (u === 'locked') return { result: 'locked' as const };
        return c === 'GOOD' ? { result: 'ok' as const, userId: 'u1' } : { result: 'wrong' as const };
      }),
      setPassword: jest.fn(async (id: string, p: string) => {
        calls.push(`password:${id}`);
        return p.length < 8 ? { weak: 'Password should be at least 8 characters.' } : ('ok' as const);
      }),
      finish: jest.fn(async (id: string) => {
        calls.push(`finish:${id}`);
      }),
      ...over,
    };
    return { d, calls };
  }
  const good = { username: 'Sam', code: 'GOOD', password: 'longenough' };

  it('AC 9: right code → password set, then the code and sessions are ended', async () => {
    const { d, calls } = deps();
    const res = await handleRecoverPasswordRequest(post(good), d);
    expect(res.status).toBe(200);
    expect(calls).toEqual(['check:Sam:GOOD', 'password:u1', 'finish:u1']);
  });

  it('AC 10: a wrong code or unknown username → wrong_code, nothing set', async () => {
    const { d, calls } = deps();
    const res = await handleRecoverPasswordRequest(post({ ...good, code: 'BAD' }), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'wrong_code', error: 'Incorrect username or recovery code.' });
    expect(calls).toEqual(['check:Sam:BAD']);
  });

  it('AC 11: locked → 429 locked, nothing set', async () => {
    const { d, calls } = deps();
    const res = await handleRecoverPasswordRequest(post({ ...good, username: 'locked' }), d);
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('locked');
    expect(calls).toEqual(['check:locked:GOOD']);
  });

  it('AC 12: a weak password → weak_password with the server text; the code is not used', async () => {
    const { d, calls } = deps();
    const res = await handleRecoverPasswordRequest(post({ ...good, password: 'short1' }), d);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ code: 'weak_password', error: 'Password should be at least 8 characters.' });
    expect(calls).not.toContain('finish:u1');
  });

  it('AC 12: Auth or the database failing → 500 failed', async () => {
    const { d } = deps({ setPassword: jest.fn(async () => Promise.reject(new Error('down'))) });
    const res = await handleRecoverPasswordRequest(post(good), d);
    expect(res.status).toBe(500);
    expect(d.finish).not.toHaveBeenCalled();
    const second = deps({ check: jest.fn(async () => Promise.reject(new Error('db'))) });
    expect((await handleRecoverPasswordRequest(post(good), second.d)).status).toBe(500);
    expect(second.d.setPassword).not.toHaveBeenCalled();
  });

  it('missing fields → 400 without a check; OPTIONS and other methods', async () => {
    const { d } = deps();
    expect((await handleRecoverPasswordRequest(post({ username: 'x', code: '' , password: 'p'}), d)).status).toBe(400);
    expect((await handleRecoverPasswordRequest(post({ username: 'x', code: 'c' }), d)).status).toBe(400);
    expect((await handleRecoverPasswordRequest(post('not json'), d)).status).toBe(400);
    expect(d.check).not.toHaveBeenCalled();
    expect((await handleRecoverPasswordRequest(post(null, {}, 'OPTIONS'), d)).status).toBe(200);
    expect((await handleRecoverPasswordRequest(post(null, {}, 'GET'), d)).status).toBe(405);
  });
});

describe('new-recovery-code', () => {
  function deps(over: Partial<NewRecoveryCodeDeps> = {}) {
    const d: NewRecoveryCodeDeps = {
      userFromToken: jest.fn(async (jwt: string) => (jwt === 'jwt-me' ? { id: 'u1', email: 'sam@users.sham.invalid' } : null)),
      checkPassword: jest.fn(async (_e: string, p: string) => (p === 'secret1' ? ('ok' as const) : ('wrong' as const))),
      replaceCode: jest.fn(async () => 'ABCD-EFGH-JKMN-PQRS'),
      ...over,
    };
    return d;
  }
  const auth = { authorization: 'Bearer jwt-me' };

  it('AC 7: the right password → a new code, for the token\'s user only', async () => {
    const d = deps();
    const res = await handleNewRecoveryCodeRequest(post({ password: 'secret1', user_id: 'someone-else' }, auth), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 'ABCD-EFGH-JKMN-PQRS' });
    expect(d.replaceCode).toHaveBeenCalledWith('u1');
    expect(d.checkPassword).toHaveBeenCalledWith('sam@users.sham.invalid', 'secret1');
  });

  it('AC 6: a wrong password is refused on the server and the code doesn\'t change', async () => {
    const d = deps();
    const res = await handleNewRecoveryCodeRequest(post({ password: 'nope' }, auth), d);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('wrong_password');
    expect(d.replaceCode).not.toHaveBeenCalled();
  });

  it('refused without a JWT or with a bad one; no password → 400', async () => {
    const d = deps();
    expect((await handleNewRecoveryCodeRequest(post({ password: 'secret1' }), d)).status).toBe(401);
    expect((await handleNewRecoveryCodeRequest(post({ password: 'secret1' }, { authorization: 'Bearer bad' }), d)).status).toBe(401);
    expect((await handleNewRecoveryCodeRequest(post({}, auth), d)).status).toBe(400);
    expect(d.replaceCode).not.toHaveBeenCalled();
  });

  it('rate limit → 429; failures → 500', async () => {
    expect(
      (await handleNewRecoveryCodeRequest(post({ password: 'x' }, auth), deps({ checkPassword: jest.fn(async () => 'rate_limited' as const) }))).status,
    ).toBe(429);
    expect(
      (await handleNewRecoveryCodeRequest(post({ password: 'secret1' }, auth), deps({ replaceCode: jest.fn(async () => Promise.reject(new Error('db'))) }))).status,
    ).toBe(500);
  });
});
