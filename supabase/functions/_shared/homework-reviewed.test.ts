/**
 * @jest-environment node
 */
// ARU-49: the homework-reviewed-notifications function's logic, with the recipient lookup and the sending helper
// mocked (AC 1, 6, 7), and once end to end with the real ARU-48 helper and a mocked Telegram (AC 3, plain text).
import {
  handleHomeworkReviewedRequest,
  type HomeworkRecipient,
  type HomeworkReviewedDeps,
  homeworkReviewedMessages,
  homeworkReviewedText,
} from './homework-reviewed';
import { sendTelegramMessages, type SendResult, type ServiceClient, type TelegramMessage } from './telegram';

const SECRET = 'hw-secret-123';
const HW = '0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d';
const post = (
  body: unknown = { homework_id: HW },
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
  method = 'POST',
) =>
  new Request('https://x.supabase.co/functions/v1/homework-reviewed-notifications', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const ok: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

function deps(rows: HomeworkRecipient[], result: Partial<SendResult> = {}) {
  const sent: TelegramMessage[][] = [];
  const logs: string[] = [];
  const d: HomeworkReviewedDeps = {
    recipient: jest.fn(async () => rows),
    send: jest.fn(async (messages: TelegramMessage[]) => {
      sent.push(messages);
      return { ...ok, sent: messages.length, ...result };
    }),
    log: (line) => logs.push(line),
  };
  return { d, sent, logs };
}

const sam: HomeworkRecipient = { course_title: 'Algebra 101', user_id: 'S1' };

describe('AC7: the secret', () => {
  it.each([
    ['no Authorization header', {}],
    ['a wrong secret', { authorization: 'Bearer nope' }],
    ['the secret without Bearer', { authorization: SECRET }],
    ['the secret in another header', { 'x-cron-secret': SECRET }],
  ])('%s: 401, nothing looked up or sent', async (_name, headers) => {
    const { d } = deps([sam]);
    const res = await handleHomeworkReviewedRequest(post(undefined, headers), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.recipient).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('an empty configured secret refuses everyone', async () => {
    const { d } = deps([sam]);
    const res = await handleHomeworkReviewedRequest(post(undefined, { authorization: 'Bearer ' }), '', d);
    expect(res.status).toBe(401);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('only POST', async () => {
    const { d } = deps([sam]);
    const res = await handleHomeworkReviewedRequest(post(undefined, undefined, 'GET'), SECRET, d);
    expect(res.status).toBe(405);
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('AC1: the message', () => {
  it('text is exactly "Your homework for <course title> was reviewed"', () => {
    expect(homeworkReviewedText('Algebra 101')).toBe('Your homework for Algebra 101 was reviewed');
    expect(homeworkReviewedText('*Bold_ <i>')).toBe('Your homework for *Bold_ <i> was reviewed');
  });

  it('the right secret: looks up the homework and sends one homework_reviewed message to the sender', async () => {
    const { d, sent, logs } = deps([sam]);
    const res = await handleHomeworkReviewedRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.recipient).toHaveBeenCalledWith(HW);
    expect(sent).toEqual([[{ userId: 'S1', kind: 'homework_reviewed', text: 'Your homework for Algebra 101 was reviewed' }]]);
    expect(await res.json()).toEqual({ recipients: 1, sent: 1, skipped: 0, failed: [], removed: 0 });
    expect(logs.join('\n')).toContain(`homework-reviewed: ${HW}: 1 recipient(s), sent 1, skipped 0, removed 0, failed 0`);
  });

  it('builds one message per recipient row', () => {
    expect(homeworkReviewedMessages([])).toEqual([]);
    expect(homeworkReviewedMessages([sam])).toHaveLength(1);
  });
});

describe('AC5 / AC7: nothing to send', () => {
  it('no recipient (not checked, not Approved, can\'t see the course, unknown id): nothing sent, 200', async () => {
    const { d, logs } = deps([]);
    const res = await handleHomeworkReviewedRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ recipients: 0, sent: 0 });
    expect(logs.join('\n')).toContain('0 recipient(s)');
  });

  it.each([
    ['no body', ''],
    ['not JSON', 'not json'],
    ['no homework_id', {}],
    ['a garbage homework_id', { homework_id: "x'; drop table homework; --" }],
    ['a number', { homework_id: 42 }],
  ])('%s: 400, nothing looked up or sent', async (_name, body) => {
    const { d } = deps([sam]);
    const res = await handleHomeworkReviewedRequest(post(body), SECRET, d);
    expect(res.status).toBe(400);
    expect(d.recipient).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('AC6: failures are logged and dropped', () => {
  it('a lookup error: 500, nothing sent, logged', async () => {
    const { d, logs } = deps([]);
    d.recipient = jest.fn(async () => {
      throw new Error('permission denied');
    });
    const res = await handleHomeworkReviewedRequest(post(), SECRET, d);
    expect(res.status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('permission denied');
  });

  it('the helper\'s failed sends are reported and logged', async () => {
    const failed = [{ userId: 'S1', error: '500 Internal Server Error' }];
    const { d, logs } = deps([sam], { sent: 0, failed });
    const res = await handleHomeworkReviewedRequest(post(), SECRET, d);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect((await res.json()).failed).toEqual(failed);
    expect(logs.join('\n')).toMatch(/sent 0, skipped 0, removed 0, failed 1 \(S1: 500 Internal Server Error\)/);
  });

  it('the helper throwing: logged as failed, still 200', async () => {
    const { d, logs } = deps([sam]);
    d.send = jest.fn(async () => {
      throw new Error('telegram_links unreachable');
    });
    const res = await handleHomeworkReviewedRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect((await res.json()).failed).toEqual([{ userId: 'S1', error: 'telegram_links unreachable' }]);
    expect(logs.join('\n')).toContain('failed 1 (S1: telegram_links unreachable)');
  });
});

describe('end to end with the ARU-48 helper', () => {
  const run = async (links: Record<string, unknown>[]) => {
    const client = {
      from: () => ({
        select: () => ({
          in: (_c: string, ids: string[]) =>
            Promise.resolve({ data: links.filter((l) => ids.includes(l.user_id as string)), error: null }),
        }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
    } as unknown as ServiceClient;
    const fetchFn = jest.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await handleHomeworkReviewedRequest(post(), SECRET, {
      recipient: async () => [{ course_title: 'Algebra *1*', user_id: 'S1' }],
      send: (messages) =>
        sendTelegramMessages(client, 'TOKEN', fetchFn as unknown as typeof fetch, messages, { sleep: async () => {} }),
    });
    return { body: await res.json(), fetchFn };
  };

  it('AC1: linked with Homework reviewed on: one plain-text message to the linked chat', async () => {
    const { body, fetchFn } = await run([{ user_id: 'S1', chat_id: 11, notify_homework_reviewed: true }]);
    expect(body).toMatchObject({ recipients: 1, sent: 1, skipped: 0, failed: [] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ chat_id: 11, text: 'Your homework for Algebra *1* was reviewed' });
    expect(sent.parse_mode).toBeUndefined();
  });

  it('AC3: Homework reviewed off: skipped, nothing sent', async () => {
    const { body, fetchFn } = await run([{ user_id: 'S1', chat_id: 11, notify_homework_reviewed: false }]);
    expect(body).toMatchObject({ recipients: 1, sent: 0, skipped: 1 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('AC3: not linked: skipped, nothing sent', async () => {
    const { body, fetchFn } = await run([]);
    expect(body).toMatchObject({ recipients: 1, sent: 0, skipped: 1 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
