/**
 * @jest-environment node
 */
// ARU-44: the chat-message-notifications function's logic, with the recipients lookup and the sending helper mocked
// (AC 1, 7, 8), and once end to end with the real push sender and a mocked Expo push service (AC 5: switch and phone).
import {
  type ChatMessageDeps,
  type ChatMessageRecipients,
  chatMessageMessages,
  chatMessageText,
  handleChatMessageRequest,
} from './chat-message';
import { type SendResult, type NotificationMessage } from './notification';
import { sendPushMessages } from './push';
import { pushClient, pushFetch } from './push-test-helpers';

const SECRET = 'chat-secret-123';
const MSG = '0b6f1c1e-2a3b-4c5d-8e9f-001122334455';
const URL_ = 'https://x.supabase.co/functions/v1/chat-message-notifications';
const post = (
  body: unknown = { message_id: MSG },
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
  method = 'POST',
) =>
  new Request(URL_, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const ok: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

function deps(found: ChatMessageRecipients | null, result: Partial<SendResult> = {}) {
  const sent: NotificationMessage[][] = [];
  const logs: string[] = [];
  const d: ChatMessageDeps = {
    recipients: jest.fn(async () => found),
    send: jest.fn(async (messages: NotificationMessage[]) => {
      sent.push(messages);
      return { ...ok, sent: messages.length, ...result };
    }),
    log: (line) => logs.push(line),
  };
  return { d, sent, logs };
}

const algebra: ChatMessageRecipients = { course_title: 'Algebra 101', recipient_ids: ['O', 'T1'] };

describe('AC 8: the secret', () => {
  it.each([
    ['no Authorization header', {}],
    ['a wrong secret', { authorization: 'Bearer nope' }],
    ['a same-length wrong secret', { authorization: 'Bearer chat-secret-124' }],
    ['the secret without "Bearer "', { authorization: SECRET }],
    ['the secret in another header', { 'x-chat-secret': SECRET }],
  ])('%s: 401, nothing looked up or sent', async (_name, headers) => {
    const { d } = deps(algebra);
    const res = await handleChatMessageRequest(post(undefined, headers), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.recipients).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('an empty configured secret refuses everyone', async () => {
    const { d } = deps(algebra);
    const res = await handleChatMessageRequest(post(undefined, { authorization: 'Bearer ' }), '', d);
    expect(res.status).toBe(401);
    expect(d.recipients).not.toHaveBeenCalled();
  });

  it('only POST', async () => {
    const { d } = deps(algebra);
    const res = await handleChatMessageRequest(post(undefined, undefined, 'GET'), SECRET, d);
    expect(res.status).toBe(405);
    expect(d.recipients).not.toHaveBeenCalled();
  });
});

describe('a missing or invalid message_id: 400, nothing sent', () => {
  it.each([
    ['no body', ''],
    ['not JSON', 'message_id='],
    ['JSON null', 'null'],
    ['no message_id', {}],
    ['a number', { message_id: 5 }],
    ['not a uuid', { message_id: 'abc' }],
  ])('%s', async (_name, body) => {
    const { d } = deps(algebra);
    const res = await handleChatMessageRequest(post(body), SECRET, d);
    expect(res.status).toBe(400);
    expect(d.recipients).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('AC 1: recipients, then one message each', () => {
  it('looks up the message and sends "New message in the <title> chat" with kind chat_message', async () => {
    const { d, sent } = deps(algebra);
    const res = await handleChatMessageRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.recipients).toHaveBeenCalledWith(MSG);
    expect(sent).toEqual([
      [
        { userId: 'O', kind: 'chat_message', text: 'New message in the Algebra 101 chat' },
        { userId: 'T1', kind: 'chat_message', text: 'New message in the Algebra 101 chat' },
      ],
    ]);
    expect(await res.json()).toEqual({ message_id: MSG, recipients: 2, sent: 2, skipped: 0, failed: [], removed: 0 });
  });

  it('special characters in the title stay as typed', () => {
    expect(chatMessageText('*Math_1* <A&B> 🧮')).toBe('New message in the *Math_1* <A&B> 🧮 chat');
  });

  it('the text never includes the chat message or its author', () => {
    const messages = chatMessageMessages({ course_title: 'Algebra', recipient_ids: ['O'] });
    expect(messages).toEqual([{ userId: 'O', kind: 'chat_message', text: 'New message in the Algebra chat' }]);
  });

  it.each([
    ['no recipients', { course_title: 'Algebra', recipient_ids: [] }],
    ['a null recipient list', { course_title: 'Algebra', recipient_ids: null }],
    ['an unknown or deleted message', null],
  ])('%s: nothing sent, 200', async (_name, found) => {
    const { d, logs } = deps(found as ChatMessageRecipients | null);
    const res = await handleChatMessageRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ message_id: MSG, recipients: 0, sent: 0, skipped: 0, failed: [], removed: 0 });
    expect(logs).toHaveLength(1);
  });

  it('a database error: 500, nothing sent, logged', async () => {
    const { d, logs } = deps(null);
    d.recipients = jest.fn(async () => {
      throw new Error('permission denied');
    });
    const res = await handleChatMessageRequest(post(), SECRET, d);
    expect(res.status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('permission denied');
  });
});

describe('AC 7: the helper result is logged; failures are dropped, not retried', () => {
  it('logs the counts and failures from the helper and sends once', async () => {
    const failed = [{ userId: 'T1', error: '500 Internal Server Error' }];
    const { d, logs } = deps(algebra, { sent: 1, skipped: 0, removed: 0, failed });
    const res = await handleChatMessageRequest(post(), SECRET, d);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect((await res.json()).failed).toEqual(failed);
    expect(logs).toEqual([
      `chat-message: ${MSG}: 2 recipient(s), sent 1, skipped 0, removed 0, failed 1 (T1: 500 Internal Server Error)`,
    ]);
  });
});

describe('end to end with the push sender', () => {
  it('AC 5: recipients without a phone or with the switch off are skipped; plain text', async () => {
    const { client } = pushClient([
      { user_id: 'O', chat_id: 11, notify_chat_message: true, notify_meeting_started: false },
      { user_id: 'T1', chat_id: 22, notify_chat_message: false, notify_meeting_started: true },
    ]);
    const push = pushFetch();
    const res = await handleChatMessageRequest(post(), SECRET, {
      recipients: async () => ({ course_title: 'Algebra *1*', recipient_ids: ['O', 'T1', 'S9'] }),
      send: (messages) => sendPushMessages(client, push.fetch, messages, { sleep: async () => {} }),
    });
    expect(await res.json()).toMatchObject({ recipients: 3, sent: 1, skipped: 2, failed: [] });
    expect(push.requests).toHaveLength(1);
    expect(push.sent()).toEqual([[11, 'New message in the Algebra *1* chat']]);
  });
});
