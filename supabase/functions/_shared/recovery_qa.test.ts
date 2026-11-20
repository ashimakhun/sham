/**
 * @jest-environment node
 */
// ARU-165 QA: security of the recover-password and new-recovery-code logic. No account id from the request body is
// ever used; unknown usernames and wrong codes get byte-identical answers; a lock or a wrong code never sets a password.
import {
  handleNewRecoveryCodeRequest,
  handleRecoverPasswordRequest,
  type NewRecoveryCodeDeps,
  type RecoverPasswordDeps,
} from './recovery';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://x.supabase.co/functions/v1/f', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

function recoverDeps(result: 'ok' | 'wrong' | 'locked'): RecoverPasswordDeps {
  return {
    check: jest.fn(async () => (result === 'ok' ? { result: 'ok' as const, userId: 'victim-from-db' } : { result })),
    setPassword: jest.fn(async () => 'ok' as const),
    finish: jest.fn(async () => {}),
  };
}

describe('recover-password QA', () => {
  it('AC 10: an unknown username and a wrong code get identical status and body', async () => {
    const a = await handleRecoverPasswordRequest(post({ username: 'nobody', code: 'X', password: 'secret12' }), recoverDeps('wrong'));
    const b = await handleRecoverPasswordRequest(post({ username: 'sam', code: 'X', password: 'secret12' }), recoverDeps('wrong'));
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  it.each(['wrong', 'locked'] as const)('%s: never sets a password or ends sessions', async (r) => {
    const d = recoverDeps(r);
    const res = await handleRecoverPasswordRequest(post({ username: 'sam', code: 'X', password: 'secret12' }), d);
    expect(res.status).toBe(r === 'locked' ? 429 : 403);
    expect(d.setPassword).not.toHaveBeenCalled();
    expect(d.finish).not.toHaveBeenCalled();
  });

  it('only the account from the code check is changed; ids in the body are ignored', async () => {
    const d = recoverDeps('ok');
    await handleRecoverPasswordRequest(
      post({ username: 'sam', code: 'X', password: 'secret12', userId: 'other', user_id: 'other', account: 'other' }),
      d,
    );
    expect(d.setPassword).toHaveBeenCalledWith('victim-from-db', 'secret12');
    expect(d.finish).toHaveBeenCalledWith('victim-from-db');
  });

  it('non-string fields are refused before any check (no lock counting from junk)', async () => {
    const d = recoverDeps('wrong');
    for (const body of [{ username: ['sam'], code: 'X', password: 'p' }, { username: 'sam', code: 1, password: 'p' }]) {
      expect((await handleRecoverPasswordRequest(post(body), d)).status).toBe(400);
    }
    expect(d.check).not.toHaveBeenCalled();
  });
});

describe('new-recovery-code QA', () => {
  function deps(): NewRecoveryCodeDeps {
    return {
      userFromToken: jest.fn(async () => ({ id: 'me', email: 'me@users.sham.invalid' })),
      checkPassword: jest.fn(async (_e: string, p: string) => (p === 'right' ? 'ok' : 'wrong') as 'ok' | 'wrong'),
      replaceCode: jest.fn(async () => 'AAAA-BBBB-CCCC-DDDD'),
    };
  }

  it('replaces only the token user\'s code, whatever id the body names', async () => {
    const d = deps();
    const res = await handleNewRecoveryCodeRequest(
      post({ password: 'right', userId: 'victim', account: 'victim' }, { authorization: 'Bearer jwt' }),
      d,
    );
    expect(res.status).toBe(200);
    expect(d.checkPassword).toHaveBeenCalledWith('me@users.sham.invalid', 'right');
    expect(d.replaceCode).toHaveBeenCalledWith('me');
  });

  it('AC 6: the password is checked on the server; a wrong one never replaces the code', async () => {
    const d = deps();
    const res = await handleNewRecoveryCodeRequest(post({ password: 'wrong' }, { authorization: 'Bearer jwt' }), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'wrong_password' });
    expect(d.replaceCode).not.toHaveBeenCalled();
  });
});
