/**
 * @jest-environment node
 */
// ARU-87: chat-message-notifications also handles {"general_message_id"} (the general chat): the text and kind, the
// secret, the body rules (exactly one id), an unknown message, and once end to end with the real ARU-48 helper (the
// General chat switch is separate from Chat messages). Course chat behaviour is in chat-message.test.ts.
import {
  type ChatMessageDeps,
  type GeneralMessageRecipients,
  GENERAL_CHAT_TEXT,
  generalMessageMessages,
  handleChatMessageRequest,
} from './chat-message';
import { sendTelegramMessages, type SendResult, type ServiceClient, type TelegramMessage } from './telegram';

const SECRET = 'chat-secret-123';
const MSG = '0b6f1c1e-2a3b-4c5d-8e9f-001122334455';
const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) =>
  new Request('https://x.supabase.co/functions/v1/chat-message-notifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const ok: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

function deps(found: GeneralMessageRecipients | null) {
  const sent: TelegramMessage[][] = [];
  const logs: string[] = [];
  const d: ChatMessageDeps = {
    recipients: jest.fn(async () => ({ course_title: 'Algebra', recipient_ids: ['X'] })),
    generalRecipients: jest.fn(async () => found),
    send: jest.fn(async (messages: TelegramMessage[]) => {
      sent.push(messages);
      return { ...ok, sent: messages.length };
    }),
    log: (line) => logs.push(line),
  };
  return { d, sent, logs };
}

describe('AC 4: the general chat message', () => {
  it('text is exactly "New message in the general chat" with kind general_chat, one per recipient', () => {
    expect(GENERAL_CHAT_TEXT).toBe('New message in the general chat');
    expect(generalMessageMessages({ recipient_ids: ['A', 'B'] })).toEqual([
      { userId: 'A', kind: 'general_chat', text: 'New message in the general chat' },
      { userId: 'B', kind: 'general_chat', text: 'New message in the general chat' },
    ]);
    expect(generalMessageMessages(null)).toEqual([]);
    expect(generalMessageMessages({ recipient_ids: null })).toEqual([]);
  });

  it('looks up the general message and sends to each recipient; never the course chat lookup', async () => {
    const { d, sent, logs } = deps({ recipient_ids: ['S1', 'T'] });
    const res = await handleChatMessageRequest(post({ general_message_id: MSG }), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.generalRecipients).toHaveBeenCalledWith(MSG);
    expect(d.recipients).not.toHaveBeenCalled();
    expect(sent).toEqual([
      [
        { userId: 'S1', kind: 'general_chat', text: GENERAL_CHAT_TEXT },
        { userId: 'T', kind: 'general_chat', text: GENERAL_CHAT_TEXT },
      ],
    ]);
    expect(await res.json()).toEqual({ general_message_id: MSG, recipients: 2, sent: 2, skipped: 0, failed: [], removed: 0 });
    expect(logs.join('\n')).toContain(`general-message: ${MSG}: 2 recipient(s), sent 2`);
  });

  it('an unknown message: 200, nothing sent', async () => {
    const { d } = deps(null);
    const res = await handleChatMessageRequest(post({ general_message_id: MSG }), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ general_message_id: MSG, recipients: 0 });
  });

  it('a database error: 500, nothing sent', async () => {
    const { d } = deps(null);
    (d.generalRecipients as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    expect((await handleChatMessageRequest(post({ general_message_id: MSG }), SECRET, d)).status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('the secret and the body', () => {
  it.each([
    ['no Authorization header', {}],
    ['a wrong secret', { authorization: 'Bearer nope' }],
  ])('%s: 401, nothing looked up or sent', async (_n, headers) => {
    const { d } = deps({ recipient_ids: ['S1'] });
    const res = await handleChatMessageRequest(post({ general_message_id: MSG }, headers), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.generalRecipients).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it.each([
    ['both ids', { message_id: MSG, general_message_id: MSG }],
    ['neither id', {}],
    ['a malformed general id', { general_message_id: 'nope' }],
    ['a numeric general id', { general_message_id: 42 }],
  ])('%s: 400, nothing looked up or sent', async (_n, body) => {
    const { d } = deps({ recipient_ids: ['S1'] });
    expect((await handleChatMessageRequest(post(body), SECRET, d)).status).toBe(400);
    expect(d.recipients).not.toHaveBeenCalled();
    expect(d.generalRecipients).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('AC 6: with the real helper, General chat and Chat messages are separate switches', () => {
  function client(links: Record<string, unknown>[]): ServiceClient {
    return {
      from: () => ({
        select: () => ({ in: async () => ({ data: links, error: null }) }),
        delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
      }),
    };
  }

  it('general chat follows notify_general_chat only', async () => {
    const links = [
      { user_id: 'on', chat_id: 1, notify_general_chat: true, notify_chat_message: false },
      { user_id: 'off', chat_id: 2, notify_general_chat: false, notify_chat_message: true },
    ];
    const fetchFn = jest.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const { d } = deps({ recipient_ids: ['on', 'off'] });
    d.send = (messages) => sendTelegramMessages(client(links), 'TOKEN', fetchFn as unknown as typeof fetch, messages);
    const body = await (await handleChatMessageRequest(post({ general_message_id: MSG }), SECRET, d)).json();
    expect(body).toMatchObject({ recipients: 2, sent: 1, skipped: 1 });
    const sentBody = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sentBody).toEqual({ chat_id: 1, text: GENERAL_CHAT_TEXT, disable_web_page_preview: true });
  });

  it('course chats still follow notify_chat_message only', async () => {
    const links = [
      { user_id: 'on', chat_id: 1, notify_general_chat: false, notify_chat_message: true },
      { user_id: 'off', chat_id: 2, notify_general_chat: true, notify_chat_message: false },
    ];
    const fetchFn = jest.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const { d } = deps(null);
    d.recipients = jest.fn(async () => ({ course_title: 'Algebra', recipient_ids: ['on', 'off'] }));
    d.send = (messages) => sendTelegramMessages(client(links), 'TOKEN', fetchFn as unknown as typeof fetch, messages);
    const body = await (await handleChatMessageRequest(post({ message_id: MSG }), SECRET, d)).json();
    expect(body).toMatchObject({ message_id: MSG, recipients: 2, sent: 1, skipped: 1 });
  });
});

describe('wiring', () => {
  const fs = jest.requireActual<{ readFileSync: (p: string, e: string) => string }>('fs');
  it('the function calls general_message_recipients with the SQL argument name', () => {
    const fn = fs.readFileSync('supabase/functions/chat-message-notifications/index.ts', 'utf8');
    const migration = fs.readFileSync('supabase/migrations/0046_every_chat_message_notifications.sql', 'utf8');
    expect(fn).toMatch(/rpc\('general_message_recipients', \{ message: messageId \}\)/);
    expect(migration).toMatch(/create function general_message_recipients\(message uuid\)/);
    expect(migration).toContain("jsonb_build_object('general_message_id', new.id)");
  });
});
