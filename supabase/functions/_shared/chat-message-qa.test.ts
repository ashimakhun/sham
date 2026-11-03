/**
 * @jest-environment node
 */
// QA ARU-44: gaps in chat-message.test.ts: near-miss Authorization headers, the secret in the query string, odd JSON
// bodies, an unknown message (200, nothing sent), a known message with no recipients or a null list, the report a call
// returns, and the wiring between the Edge Function, the migration and the README (names must match exactly).
import { type ChatMessageDeps, type ChatMessageRecipients, handleChatMessageRequest } from './chat-message';
import type { SendResult, TelegramMessage } from './telegram';

const fs = jest.requireActual<{ readFileSync: (p: string, e: string) => string }>('fs');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const SECRET = 'chat-secret-123';
const MSG = '0b6f1c1e-2a3b-4c5d-8e9f-001122334455';
const URL_ = 'https://x.supabase.co/functions/v1/chat-message-notifications';

function deps(found: ChatMessageRecipients | null) {
  const d: ChatMessageDeps = {
    recipients: jest.fn(async () => found),
    send: jest.fn(async (messages: TelegramMessage[]): Promise<SendResult> => ({
      sent: messages.length - 1,
      skipped: 1,
      failed: [],
      removed: 0,
    })),
    log: jest.fn(),
  };
  return d;
}
const req = (body: string | undefined, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }, url = URL_) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

it.each([
  ['lower-case "bearer"', { authorization: `bearer ${SECRET}` }],
  ['two spaces', { authorization: `Bearer  ${SECRET}` }],
  ['the secret with an extra character', { authorization: `Bearer ${SECRET}x` }],
  ['a prefix of the secret', { authorization: `Bearer ${SECRET.slice(0, -1)}` }],
  ['an empty bearer', { authorization: 'Bearer ' }],
])('AC 8: %s gets 401 and nothing is looked up', async (_k, headers) => {
  const d = deps({ course_title: 'A', recipient_ids: ['U1'] });
  const res = await handleChatMessageRequest(req(JSON.stringify({ message_id: MSG }), headers), SECRET, d);
  expect(res.status).toBe(401);
  expect(d.recipients).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('AC 8: the secret in the query string gets 401', async () => {
  const d = deps({ course_title: 'A', recipient_ids: ['U1'] });
  const res = await handleChatMessageRequest(req(JSON.stringify({ message_id: MSG }), {}, `${URL_}?secret=${SECRET}`), SECRET, d);
  expect(res.status).toBe(401);
  expect(d.recipients).not.toHaveBeenCalled();
});

it.each([
  ['null', 'null'],
  ['an array', JSON.stringify([MSG])],
  ['a number', '42'],
  ['the id nested', JSON.stringify({ message: { message_id: MSG } })],
  ['the id as a number', JSON.stringify({ message_id: 123 })],
  ['the id with spaces around it', JSON.stringify({ message_id: ` ${MSG} ` })],
  ['an SQL-looking id', JSON.stringify({ message_id: `${MSG}' or '1'='1` })],
  ['no body', undefined],
])('AC 8: a body of %s: 400, nothing looked up or sent', async (_k, body) => {
  const d = deps({ course_title: 'A', recipient_ids: ['U1'] });
  const res = await handleChatMessageRequest(req(body), SECRET, d);
  expect(res.status).toBe(400);
  expect(d.recipients).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('an upper-case uuid is accepted and passed on as given', async () => {
  const d = deps({ course_title: 'A', recipient_ids: ['U1', 'U2'] });
  const res = await handleChatMessageRequest(req(JSON.stringify({ message_id: MSG.toUpperCase() })), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.recipients).toHaveBeenCalledWith(MSG.toUpperCase());
});

it.each([
  ['an unknown or deleted message', null],
  ['a message with no recipients', { course_title: 'A', recipient_ids: [] }],
  ['a null recipient list', { course_title: 'A', recipient_ids: null }],
])('%s: 200, nothing sent, report says 0', async (_k, found) => {
  const d = deps(found);
  const res = await handleChatMessageRequest(req(JSON.stringify({ message_id: MSG })), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.send).not.toHaveBeenCalled();
  expect(await res.json()).toEqual({ message_id: MSG, recipients: 0, sent: 0, skipped: 0, failed: [], removed: 0 });
  expect(d.log).toHaveBeenCalledTimes(1);
});

it('AC 7: the report is the helper result plus the message id and the recipient count; one send call', async () => {
  const d = deps({ course_title: 'Algebra', recipient_ids: ['U1', 'U2', 'U3'] });
  const res = await handleChatMessageRequest(req(JSON.stringify({ message_id: MSG, extra: 'ignored' })), SECRET, d);
  expect(await res.json()).toEqual({ message_id: MSG, recipients: 3, sent: 2, skipped: 1, failed: [], removed: 0 });
  expect(d.send).toHaveBeenCalledTimes(1);
  expect((d.send as jest.Mock).mock.calls[0][0]).toEqual(
    ['U1', 'U2', 'U3'].map((userId) => ({ userId, kind: 'chat_message', text: 'New message in the Algebra chat' })),
  );
});

describe('wiring: the Edge Function, the migration and the README use the same names', () => {
  const fn = read('supabase/functions/chat-message-notifications/index.ts');
  const migration = read('supabase/migrations/0036_chat_message_notifications.sql');
  const readme = read('README.md');

  it('the function calls chat_message_recipients with the argument name the SQL function has', () => {
    expect(fn).toMatch(/rpc\('chat_message_recipients', \{ message: messageId \}\)/);
    expect(migration).toMatch(/create function chat_message_recipients\(message uuid\)/);
  });

  it('the function reads CHAT_NOTIFY_SECRET and the trigger reads chat_notify_url / chat_notify_secret from Vault', () => {
    expect(fn).toContain("Deno.env.get('CHAT_NOTIFY_SECRET')");
    expect(migration).toContain("name = 'chat_notify_url'");
    expect(migration).toContain("name = 'chat_notify_secret'");
  });

  it('the README names the function, the secret, both Vault names and --no-verify-jwt', () => {
    for (const s of ['chat-message-notifications', 'CHAT_NOTIFY_SECRET', 'chat_notify_url', 'chat_notify_secret', '--no-verify-jwt']) {
      expect(readme).toContain(s);
    }
    expect(readme).toContain('0036_chat_message_notifications.sql');
  });
});
