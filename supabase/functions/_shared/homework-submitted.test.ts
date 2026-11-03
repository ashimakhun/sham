/**
 * @jest-environment node
 */
// ARU-89: the homework-submitted-notifications function's logic, with the recipient lookup and the sending helper
// mocked (AC 1, 5, 7, 8), and once end to end with the real ARU-48 helper and a mocked Telegram (AC 4 switch).
import {
  handleHomeworkSubmittedRequest,
  type HomeworkSubmittedDeps,
  homeworkSubmittedMessages,
  type HomeworkSubmittedRecipient,
  homeworkSubmittedText,
} from './homework-submitted';
import { sendTelegramMessages, type SendResult, type ServiceClient, type TelegramMessage } from './telegram';

const SECRET = 'sub-secret-123';
const HW = '0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d';
const post = (
  body: unknown = { homework_id: HW },
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
  method = 'POST',
) =>
  new Request('https://x.supabase.co/functions/v1/homework-submitted-notifications', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const ok: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

function deps(rows: HomeworkSubmittedRecipient[], result: Partial<SendResult> = {}) {
  const sent: TelegramMessage[][] = [];
  const logs: string[] = [];
  const d: HomeworkSubmittedDeps = {
    recipient: jest.fn(async () => rows),
    send: jest.fn(async (messages: TelegramMessage[]) => {
      sent.push(messages);
      return { ...ok, sent: messages.length, ...result };
    }),
    log: (line) => logs.push(line),
  };
  return { d, sent, logs };
}

const row: HomeworkSubmittedRecipient = {
  course_title: 'Algebra',
  assignment_title: 'Chapter 3',
  sender_name: 'Student Sam',
  user_id: 'M',
};
const TEXT = 'New homework to check from Student Sam in Algebra: Chapter 3';

describe('AC8: the secret', () => {
  it.each([
    ['no Authorization header', {}],
    ['a wrong secret', { authorization: 'Bearer nope' }],
    ['the secret without Bearer', { authorization: SECRET }],
  ])('%s: 401, nothing looked up or sent', async (_name, headers) => {
    const { d } = deps([row]);
    const res = await handleHomeworkSubmittedRequest(post(undefined, headers), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.recipient).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('an empty configured secret refuses everyone', async () => {
    const { d } = deps([row]);
    expect((await handleHomeworkSubmittedRequest(post(undefined, { authorization: 'Bearer ' }), '', d)).status).toBe(401);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('only POST', async () => {
    const { d } = deps([row]);
    expect((await handleHomeworkSubmittedRequest(post(undefined, undefined, 'GET'), SECRET, d)).status).toBe(405);
  });
});

describe('AC1: the message', () => {
  it('text is exactly as the story sets it, names and titles as typed', () => {
    expect(homeworkSubmittedText('Student Sam', 'Algebra', 'Chapter 3')).toBe(TEXT);
    expect(homeworkSubmittedText('Дана *_', '<b>C</b> & 😀', 'x: y')).toBe(
      'New homework to check from Дана *_ in <b>C</b> & 😀: x: y',
    );
  });

  it('the right secret: one homework_submitted message to the owner', async () => {
    const { d, sent, logs } = deps([row]);
    const res = await handleHomeworkSubmittedRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.recipient).toHaveBeenCalledWith(HW);
    expect(sent).toEqual([[{ userId: 'M', kind: 'homework_submitted', text: TEXT }]]);
    expect(await res.json()).toEqual({ recipients: 1, sent: 1, skipped: 0, failed: [], removed: 0 });
    expect(logs.join('\n')).toContain(`homework-submitted: ${HW}: 1 recipient(s), sent 1`);
  });

  it('one message per row', () => {
    expect(homeworkSubmittedMessages([row, row]).map((m) => m.kind)).toEqual(['homework_submitted', 'homework_submitted']);
  });
});

describe('AC5: nothing to send', () => {
  it('no recipient: 200, nothing sent', async () => {
    const { d } = deps([]);
    const res = await handleHomeworkSubmittedRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ recipients: 0, sent: 0, skipped: 0, failed: [], removed: 0 });
  });

  it.each([[{}], [{ homework_id: 'nope' }], ['not json'], [{ user_id: HW }]])('bad body %p: 400', async (body) => {
    const { d } = deps([row]);
    expect((await handleHomeworkSubmittedRequest(post(body), SECRET, d)).status).toBe(400);
    expect(d.recipient).not.toHaveBeenCalled();
  });
});

describe('AC7: failures are logged and dropped', () => {
  it('the lookup failing: 500, nothing sent', async () => {
    const { d, logs } = deps([row]);
    (d.recipient as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    expect((await handleHomeworkSubmittedRequest(post(), SECRET, d)).status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('recipient lookup failed: db down');
  });

  it('the helper throwing: 200 with the failure reported', async () => {
    const { d } = deps([row]);
    (d.send as jest.Mock).mockRejectedValueOnce(new Error('telegram down'));
    const res = await handleHomeworkSubmittedRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect((await res.json()).failed).toEqual([{ userId: 'M', error: 'telegram down' }]);
  });
});

describe('AC4: with the real helper, the Homework submitted switch decides', () => {
  function client(on: boolean): ServiceClient {
    const link = { user_id: 'M', chat_id: 55, notify_chat_message: true, notify_homework_submitted: on };
    return {
      from: () => ({
        select: () => ({ in: async () => ({ data: [link], error: null }) }),
        delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
      }),
    };
  }
  const run = async (on: boolean) => {
    const fetchFn = jest.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const { d } = deps([row]);
    d.send = (messages) => sendTelegramMessages(client(on), 'TOKEN', fetchFn as unknown as typeof fetch, messages);
    const res = await handleHomeworkSubmittedRequest(post(), SECRET, d);
    return { body: await res.json(), fetchFn };
  };

  it('on: sent as plain text to the owner\'s chat', async () => {
    const { body, fetchFn } = await run(true);
    expect(body.sent).toBe(1);
    const sentBody = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sentBody).toEqual({ chat_id: 55, text: TEXT, disable_web_page_preview: true });
  });

  it('off: skipped, Telegram not called', async () => {
    const { body, fetchFn } = await run(false);
    expect(body).toMatchObject({ sent: 0, skipped: 1 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
