/**
 * @jest-environment node
 */
// QA ARU-84: gaps in new-account.test.ts: near-miss Authorization headers, the secret in the query string, odd bodies,
// an upper-case uuid, the report a call returns, the secret and the name never logged, and the wiring between the Edge
// Function, the migration and the README.
import { handleNewAccountRequest, type NewAccountDeps, type NewAccountRecipient } from './new-account';
import type { SendResult, TelegramMessage } from './telegram';

const fs = jest.requireActual<{ readFileSync: (p: string, e: string) => string }>('fs');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const SECRET = 'acc-secret-123';
const USER = '0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d';
const URL_ = 'https://x.supabase.co/functions/v1/new-account-notifications';
const req = (body: string | undefined, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }, url = URL_) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

function deps(rows: NewAccountRecipient[]) {
  const logs: string[] = [];
  const d: NewAccountDeps = {
    recipient: jest.fn(async () => rows),
    send: jest.fn(async (m: TelegramMessage[]): Promise<SendResult> => ({ sent: m.length, skipped: 0, failed: [], removed: 0 })),
    log: (line) => logs.push(line),
  };
  return { d, logs };
}
const dana: NewAccountRecipient = { account_name: 'Dana Serikova', user_id: 'T' };

it.each([
  ['lower-case "bearer"', { authorization: `bearer ${SECRET}` }],
  ['two spaces', { authorization: `Bearer  ${SECRET}` }],
  ['a prefix of the secret', { authorization: `Bearer ${SECRET.slice(0, -1)}` }],
  ['the secret with an extra character', { authorization: `Bearer ${SECRET}x` }],
  ['the secret without "Bearer "', { authorization: SECRET }],
])('AC7 %s: 401, nothing looked up', async (_k, headers) => {
  const { d } = deps([dana]);
  const res = await handleNewAccountRequest(req(JSON.stringify({ user_id: USER }), headers), SECRET, d);
  expect(res.status).toBe(401);
  expect(d.recipient).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('AC7 the secret in the query string: 401', async () => {
  const { d } = deps([dana]);
  const res = await handleNewAccountRequest(req(JSON.stringify({ user_id: USER }), {}, `${URL_}?secret=${SECRET}`), SECRET, d);
  expect(res.status).toBe(401);
  expect(d.recipient).not.toHaveBeenCalled();
});

it.each([
  ['null', 'null'],
  ['an array', JSON.stringify([USER])],
  ['the id nested', JSON.stringify({ user: { user_id: USER } })],
  ['the id padded', JSON.stringify({ user_id: ` ${USER} ` })],
  ['an SQL-looking id', JSON.stringify({ user_id: `${USER}' or '1'='1` })],
  ['no body', undefined],
])('a body of %s: 400, nothing looked up', async (_k, body) => {
  const { d } = deps([dana]);
  const res = await handleNewAccountRequest(req(body), SECRET, d);
  expect(res.status).toBe(400);
  expect(d.recipient).not.toHaveBeenCalled();
});

it('an upper-case uuid is accepted', async () => {
  const { d } = deps([dana]);
  const res = await handleNewAccountRequest(req(JSON.stringify({ user_id: USER.toUpperCase() })), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.recipient).toHaveBeenCalledWith(USER.toUpperCase());
});

it('the report is the helper result plus the recipient count; neither the secret nor the name is logged', async () => {
  const { d, logs } = deps([dana]);
  const res = await handleNewAccountRequest(req(JSON.stringify({ user_id: USER, extra: 1 })), SECRET, d);
  expect(await res.json()).toEqual({ recipients: 1, sent: 1, skipped: 0, failed: [], removed: 0 });
  expect(logs.join('\n')).not.toContain(SECRET);
  expect(logs.join('\n')).not.toContain('Dana');
});

describe('wiring: the Edge Function, the migration and the README use the same names', () => {
  const fn = read('supabase/functions/new-account-notifications/index.ts');
  const migration = read('supabase/migrations/0044_new_account_notifications.sql');
  const readme = read('README.md');

  it('the rpc argument matches the SQL function', () => {
    expect(fn).toMatch(/rpc\('new_account_notification', \{ account: userId \}\)/);
    expect(migration).toMatch(/create function new_account_notification\(account uuid\)/);
  });

  it('the secret and Vault names', () => {
    expect(fn).toContain("Deno.env.get('NEW_ACCOUNT_NOTIFY_SECRET')");
    expect(migration).toContain("name = 'new_account_notify_url'");
    expect(migration).toContain("name = 'new_account_notify_secret'");
  });

  it('the README names the function, the secret, both Vault names, --no-verify-jwt and the migration', () => {
    for (const s of ['new-account-notifications', 'NEW_ACCOUNT_NOTIFY_SECRET', 'new_account_notify_url', 'new_account_notify_secret', '--no-verify-jwt', '0044_new_account_notifications.sql']) {
      expect(readme).toContain(s);
    }
  });
});
