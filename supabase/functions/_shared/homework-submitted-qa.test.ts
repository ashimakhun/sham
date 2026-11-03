/**
 * @jest-environment node
 */
// QA ARU-89: gaps in homework-submitted.test.ts: near-miss Authorization headers, the secret in the query string, odd
// bodies, an upper-case uuid, the report a call returns, the secret and the homework text never logged, and the wiring
// between the Edge Function, the migration and the README.
import {
  handleHomeworkSubmittedRequest,
  type HomeworkSubmittedDeps,
  type HomeworkSubmittedRecipient,
  homeworkSubmittedText,
} from './homework-submitted';
import type { SendResult, TelegramMessage } from './telegram';

const fs = jest.requireActual<{ readFileSync: (p: string, e: string) => string }>('fs');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const SECRET = 'hw-secret-123';
const HW = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const URL_ = 'https://x.supabase.co/functions/v1/homework-submitted-notifications';
const req = (body: string | undefined, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }, url = URL_) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

const row: HomeworkSubmittedRecipient = { course_title: 'Algebra', assignment_title: 'Fractions', sender_name: 'Sam', user_id: 'M' };
function deps(rows: HomeworkSubmittedRecipient[]) {
  const logs: string[] = [];
  const d: HomeworkSubmittedDeps = {
    recipient: jest.fn(async () => rows),
    send: jest.fn(async (m: TelegramMessage[]): Promise<SendResult> => ({ sent: m.length, skipped: 0, failed: [], removed: 0 })),
    log: (line) => logs.push(line),
  };
  return { d, logs };
}

it.each([
  ['lower-case "bearer"', { authorization: `bearer ${SECRET}` }],
  ['two spaces', { authorization: `Bearer  ${SECRET}` }],
  ['a prefix of the secret', { authorization: `Bearer ${SECRET.slice(0, -1)}` }],
  ['the secret with an extra character', { authorization: `Bearer ${SECRET}x` }],
  ['the secret without "Bearer "', { authorization: SECRET }],
])('AC8 %s: 401, nothing looked up', async (_k, headers) => {
  const { d } = deps([row]);
  const res = await handleHomeworkSubmittedRequest(req(JSON.stringify({ homework_id: HW }), headers), SECRET, d);
  expect(res.status).toBe(401);
  expect(d.recipient).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('AC8 the secret in the query string: 401', async () => {
  const { d } = deps([row]);
  const res = await handleHomeworkSubmittedRequest(req(JSON.stringify({ homework_id: HW }), {}, `${URL_}?secret=${SECRET}`), SECRET, d);
  expect(res.status).toBe(401);
});

it.each([
  ['null', 'null'],
  ['an array', JSON.stringify([HW])],
  ['the id padded', JSON.stringify({ homework_id: ` ${HW} ` })],
  ['an SQL-looking id', JSON.stringify({ homework_id: `${HW}' or '1'='1` })],
  ['no body', undefined],
])('a body of %s: 400, nothing looked up', async (_k, body) => {
  const { d } = deps([row]);
  const res = await handleHomeworkSubmittedRequest(req(body), SECRET, d);
  expect(res.status).toBe(400);
  expect(d.recipient).not.toHaveBeenCalled();
});

it('an upper-case uuid is accepted; the report is the helper result plus the count', async () => {
  const { d } = deps([row]);
  const res = await handleHomeworkSubmittedRequest(req(JSON.stringify({ homework_id: HW.toUpperCase() })), SECRET, d);
  expect(d.recipient).toHaveBeenCalledWith(HW.toUpperCase());
  expect(await res.json()).toEqual({ recipients: 1, sent: 1, skipped: 0, failed: [], removed: 0 });
  expect((d.send as jest.Mock).mock.calls[0][0]).toEqual([
    { userId: 'M', kind: 'homework_submitted', text: homeworkSubmittedText('Sam', 'Algebra', 'Fractions') },
  ]);
});

it('neither the secret nor the names and titles are logged', async () => {
  const { d, logs } = deps([row]);
  await handleHomeworkSubmittedRequest(req(JSON.stringify({ homework_id: HW })), SECRET, d);
  const all = logs.join('\n');
  for (const s of [SECRET, 'Sam', 'Fractions']) expect(all).not.toContain(s);
});

describe('wiring: the Edge Function, the migration and the README use the same names', () => {
  const fn = read('supabase/functions/homework-submitted-notifications/index.ts');
  const migration = read('supabase/migrations/0045_homework_submitted_notifications.sql');
  const readme = read('README.md');

  it('the rpc argument matches the SQL function', () => {
    expect(fn).toMatch(/rpc\('homework_submitted_recipient', \{ homework: homeworkId \}\)/);
    expect(migration).toMatch(/create function homework_submitted_recipient\(homework uuid\)/);
  });

  it('the secret and Vault names', () => {
    expect(fn).toContain("Deno.env.get('HOMEWORK_SUBMITTED_NOTIFY_SECRET')");
    expect(migration).toContain("name = 'homework_submitted_notify_url'");
    expect(migration).toContain("name = 'homework_submitted_notify_secret'");
  });

  it('the README names the function, the secret, both Vault names, --no-verify-jwt and the migration', () => {
    for (const s of ['homework-submitted-notifications', 'HOMEWORK_SUBMITTED_NOTIFY_SECRET', 'homework_submitted_notify_url', 'homework_submitted_notify_secret', '--no-verify-jwt', '0045_homework_submitted_notifications.sql']) {
      expect(readme).toContain(s);
    }
  });
});
