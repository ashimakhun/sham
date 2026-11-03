/**
 * @jest-environment node
 */
// QA ARU-87: gaps in general-chat.test.ts: null and odd ids, a body that is an array or not JSON, the report a general
// chat call returns, a known message with no recipients or a null list, the function not wired for the general chat,
// the general chat path never touching the course chat lookup (and the other way round), the text never including a
// message body, and the wiring between the function, the migration, the app switch and the README.
import { type ChatMessageDeps, GENERAL_CHAT_TEXT, type GeneralMessageRecipients, handleChatMessageRequest } from './chat-message';
import { SWITCH_COLUMN, type SendResult, type TelegramMessage } from './telegram';

const fs = jest.requireActual<{ readFileSync: (p: string, e: string) => string }>('fs');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const SECRET = 'chat-secret-123';
const MSG = '0b6f1c1e-2a3b-4c5d-8e9f-001122334455';
const req = (body: string | undefined) =>
  new Request('https://x.supabase.co/functions/v1/chat-message-notifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
    body,
  });

function deps(found: GeneralMessageRecipients | null, over: Partial<ChatMessageDeps> = {}) {
  const d: ChatMessageDeps = {
    recipients: jest.fn(async () => ({ course_title: 'Algebra', recipient_ids: ['C1'] })),
    generalRecipients: jest.fn(async () => found),
    send: jest.fn(async (messages: TelegramMessage[]): Promise<SendResult> => ({ sent: messages.length, skipped: 0, failed: [], removed: 0 })),
    log: jest.fn(),
    ...over,
  };
  return d;
}

it.each([
  ['a null general id', JSON.stringify({ general_message_id: null })],
  ['a null course id', JSON.stringify({ message_id: null })],
  ['a general id with spaces around it', JSON.stringify({ general_message_id: ` ${MSG} ` })],
  ['both ids, one of them null', JSON.stringify({ message_id: MSG, general_message_id: null })],
  ['an array', JSON.stringify([{ general_message_id: MSG }])],
  ['not JSON', 'general_message_id=' + MSG],
  ['no body', undefined],
])('%s: 400, nothing looked up or sent', async (_k, body) => {
  const d = deps({ recipient_ids: ['U1'] });
  const res = await handleChatMessageRequest(req(body), SECRET, d);
  expect(res.status).toBe(400);
  expect(d.recipients).not.toHaveBeenCalled();
  expect(d.generalRecipients).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('a general chat call returns its report and never asks the course chat lookup', async () => {
  const d = deps({ recipient_ids: ['U1', 'U2'] });
  const res = await handleChatMessageRequest(req(JSON.stringify({ general_message_id: MSG, extra: 1 })), SECRET, d);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ general_message_id: MSG, recipients: 2, sent: 2, skipped: 0, failed: [], removed: 0 });
  expect(d.generalRecipients).toHaveBeenCalledWith(MSG);
  expect(d.recipients).not.toHaveBeenCalled();
  expect((d.send as jest.Mock).mock.calls[0][0]).toEqual([
    { userId: 'U1', kind: 'general_chat', text: GENERAL_CHAT_TEXT },
    { userId: 'U2', kind: 'general_chat', text: GENERAL_CHAT_TEXT },
  ]);
});

it('a course chat call never asks the general chat lookup', async () => {
  const d = deps({ recipient_ids: ['U1'] });
  const res = await handleChatMessageRequest(req(JSON.stringify({ message_id: MSG })), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.generalRecipients).not.toHaveBeenCalled();
  expect((d.send as jest.Mock).mock.calls[0][0]).toEqual([{ userId: 'C1', kind: 'chat_message', text: 'New message in the Algebra chat' }]);
});

it.each([
  ['no recipients', { recipient_ids: [] }],
  ['a null recipient list', { recipient_ids: null }],
])('a known general message with %s: 200, nothing sent', async (_k, found) => {
  const d = deps(found);
  const res = await handleChatMessageRequest(req(JSON.stringify({ general_message_id: MSG })), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.send).not.toHaveBeenCalled();
  expect((await res.json()).recipients).toBe(0);
});

it('the function without the general chat lookup wired: 500, nothing sent', async () => {
  const d = deps(null, { generalRecipients: undefined });
  const res = await handleChatMessageRequest(req(JSON.stringify({ general_message_id: MSG })), SECRET, d);
  expect(res.status).toBe(500);
  expect(d.send).not.toHaveBeenCalled();
});

it('privacy: the general chat text has no placeholder for a body or an author', () => {
  expect(GENERAL_CHAT_TEXT).toBe('New message in the general chat');
});

describe('wiring: function, migration, helper, app and README use the same names', () => {
  const migration = read('supabase/migrations/0046_every_chat_message_notifications.sql');
  const fn = read('supabase/functions/chat-message-notifications/index.ts');

  it('the helper maps general_chat to notify_general_chat, the column 0046 adds', () => {
    expect(SWITCH_COLUMN.general_chat).toBe('notify_general_chat');
    expect(migration).toContain('add column notify_general_chat boolean not null default true');
    expect(migration).toContain("when 'general_chat' then");
  });

  it('the function calls general_message_recipients with the SQL argument name, and the trigger uses the course chat Vault names', () => {
    expect(fn).toMatch(/rpc\('general_message_recipients', \{ message: messageId \}\)/);
    expect(migration).toMatch(/create function general_message_recipients\(message uuid\)/);
    expect(migration).toContain("name = 'chat_notify_url'");
    expect(migration).toContain("name = 'chat_notify_secret'");
    expect(migration).toContain("jsonb_build_object('general_message_id', new.id)");
  });

  it('the README mentions 0046 and the General chat switch', () => {
    const readme = read('README.md');
    expect(readme).toContain('0046_every_chat_message_notifications.sql');
    expect(readme).toMatch(/General chat/);
  });
});
