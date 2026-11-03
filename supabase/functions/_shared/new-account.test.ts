/**
 * @jest-environment node
 */
// ARU-84: the new-account-notifications function's logic, with the recipient lookup and the sending helper mocked
// (AC 1, 5, 6, 7), and once end to end with the real ARU-48 helper and a mocked Telegram (AC 3 switch, plain text).
import {
  handleNewAccountRequest,
  type NewAccountDeps,
  newAccountMessages,
  type NewAccountRecipient,
  newAccountText,
} from './new-account';
import { sendTelegramMessages, type SendResult, type ServiceClient, type TelegramMessage } from './telegram';

const SECRET = 'acc-secret-123';
const USER = '0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d';
const post = (
  body: unknown = { user_id: USER },
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
  method = 'POST',
) =>
  new Request('https://x.supabase.co/functions/v1/new-account-notifications', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const ok: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

function deps(rows: NewAccountRecipient[], result: Partial<SendResult> = {}) {
  const sent: TelegramMessage[][] = [];
  const logs: string[] = [];
  const d: NewAccountDeps = {
    recipient: jest.fn(async () => rows),
    send: jest.fn(async (messages: TelegramMessage[]) => {
      sent.push(messages);
      return { ...ok, sent: messages.length, ...result };
    }),
    log: (line) => logs.push(line),
  };
  return { d, sent, logs };
}

const dana: NewAccountRecipient = { account_name: 'Dana Serikova', user_id: 'T' };
const TEXT = 'New account waiting for your approval: Dana Serikova. Open Sham → Manage roles to accept or decline.';

describe('AC7: the secret', () => {
  it.each([
    ['no Authorization header', {}],
    ['a wrong secret', { authorization: 'Bearer nope' }],
    ['the secret without Bearer', { authorization: SECRET }],
  ])('%s: 401, nothing looked up or sent', async (_name, headers) => {
    const { d } = deps([dana]);
    const res = await handleNewAccountRequest(post(undefined, headers), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.recipient).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('an empty configured secret refuses everyone', async () => {
    const { d } = deps([dana]);
    const res = await handleNewAccountRequest(post(undefined, { authorization: 'Bearer ' }), '', d);
    expect(res.status).toBe(401);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('only POST', async () => {
    const { d } = deps([dana]);
    expect((await handleNewAccountRequest(post(undefined, undefined, 'GET'), SECRET, d)).status).toBe(405);
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('AC1: the message', () => {
  it('text is exactly as the story sets it, names as typed', () => {
    expect(newAccountText('Dana Serikova')).toBe(TEXT);
    expect(newAccountText('Дана "*_<b>" 😀')).toBe(
      'New account waiting for your approval: Дана "*_<b>" 😀. Open Sham → Manage roles to accept or decline.',
    );
  });

  it('the right secret: looks up the account and sends one new_account message to the teacher', async () => {
    const { d, sent, logs } = deps([dana]);
    const res = await handleNewAccountRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.recipient).toHaveBeenCalledWith(USER);
    expect(sent).toEqual([[{ userId: 'T', kind: 'new_account', text: TEXT }]]);
    expect(await res.json()).toEqual({ recipients: 1, sent: 1, skipped: 0, failed: [], removed: 0 });
    expect(logs.join('\n')).toContain(`new-account: ${USER}: 1 recipient(s), sent 1`);
  });

  it('one message per row', () => {
    expect(newAccountMessages([dana, { account_name: 'X', user_id: 'T' }]).map((m) => m.kind)).toEqual([
      'new_account',
      'new_account',
    ]);
  });
});

describe('AC5: nothing to send', () => {
  it('no recipient (accepted, declined, deleted, unknown, no teacher): 200, nothing sent', async () => {
    const { d } = deps([]);
    const res = await handleNewAccountRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ recipients: 0, sent: 0, skipped: 0, failed: [], removed: 0 });
  });

  it.each([[{}], [{ user_id: 'nope' }], ['not json'], [{ user_id: 42 }]])('bad body %p: 400, nothing sent', async (body) => {
    const { d } = deps([dana]);
    const res = await handleNewAccountRequest(post(body), SECRET, d);
    expect(res.status).toBe(400);
    expect(d.recipient).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('AC6: failures are logged and dropped', () => {
  it('the lookup failing: 500, nothing sent', async () => {
    const { d, logs } = deps([dana]);
    (d.recipient as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const res = await handleNewAccountRequest(post(), SECRET, d);
    expect(res.status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('recipient lookup failed: db down');
  });

  it('the helper throwing: 200 with the failure reported', async () => {
    const { d } = deps([dana]);
    (d.send as jest.Mock).mockRejectedValueOnce(new Error('telegram down'));
    const res = await handleNewAccountRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect((await res.json()).failed).toEqual([{ userId: 'T', error: 'telegram down' }]);
  });
});

describe('AC3: with the real helper, the New accounts switch decides', () => {
  function client(on: boolean): ServiceClient {
    const row = { user_id: 'T', chat_id: 77, notify_chat_message: true, notify_new_account: on };
    return {
      from: () => ({
        select: () => ({ in: async () => ({ data: [row], error: null }) }),
        delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
      }),
    };
  }
  const run = async (on: boolean) => {
    const fetchFn = jest.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const { d } = deps([dana]);
    d.send = (messages) => sendTelegramMessages(client(on), 'TOKEN', fetchFn as unknown as typeof fetch, messages);
    const res = await handleNewAccountRequest(post(), SECRET, d);
    return { body: await res.json(), fetchFn };
  };

  it('on: sent as plain text to the teacher\'s chat', async () => {
    const { body, fetchFn } = await run(true);
    expect(body.sent).toBe(1);
    const sentBody = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sentBody).toEqual({ chat_id: 77, text: TEXT, disable_web_page_preview: true });
  });

  it('off: skipped, Telegram not called', async () => {
    const { body, fetchFn } = await run(false);
    expect(body).toMatchObject({ sent: 0, skipped: 1 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
