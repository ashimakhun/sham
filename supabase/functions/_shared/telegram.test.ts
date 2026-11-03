/**
 * @jest-environment node
 */
// ARU-48 AC 10: the shared Telegram sending helper, with fetch and the service-role client mocked.
import { sendTelegramMessages, type ServiceClient, type TelegramMessage } from './telegram';

type Link = {
  user_id: string;
  chat_id: number;
  notify_meeting_started: boolean;
  notify_new_homework: boolean;
  notify_homework_reviewed: boolean;
  notify_chat_message: boolean;
  notify_new_account: boolean;
  notify_homework_submitted: boolean;
  notify_general_chat: boolean;
};
const link = (userId: string, chatId: number, over: Partial<Link> = {}): Link => ({
  user_id: userId,
  chat_id: chatId,
  notify_meeting_started: true,
  notify_new_homework: true,
  notify_homework_reviewed: true,
  notify_chat_message: true,
  notify_new_account: true,
  notify_homework_submitted: true,
  notify_general_chat: true,
  ...over,
});

function fakeClient(links: Link[]) {
  const deleted: [string, unknown][][] = [];
  const queried: string[][] = [];
  const client: ServiceClient = {
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          queried.push(ids);
          return Promise.resolve({ data: links.filter((l) => ids.includes(l.user_id)), error: null });
        },
      }),
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (c2: string, v2: unknown) => {
            deleted.push([
              [c1, v1],
              [c2, v2],
            ]);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  };
  return { client, deleted, queried };
}

const ok = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
const err = (status: number, description: string, retryAfter?: number) =>
  new Response(JSON.stringify({ ok: false, error_code: status, description, parameters: retryAfter ? { retry_after: retryAfter } : undefined }), {
    status,
  });

/** A fake clock: sleep advances it; nothing really waits. */
function clock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

const msg = (userId: string, kind: TelegramMessage['kind'] = 'chat_message', text = 'Hello'): TelegramMessage => ({ userId, kind, text });
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

describe('sendTelegramMessages', () => {
  it('sends only to linked users with that kind on, as plain text', async () => {
    const { client } = fakeClient([link('a', 11), link('b', 22, { notify_chat_message: false }), link('c', 33)]);
    const fetchFn = jest.fn(async () => ok());
    const c = clock();
    const result = await sendTelegramMessages(
      client,
      'TOKEN',
      fetchFn as unknown as typeof fetch,
      [msg('a', 'chat_message', 'Algebra *bold* _x_ <b>hi</b>'), msg('b'), msg('c', 'new_homework'), msg('nobody')],
      c,
    );
    expect(result).toEqual({ sent: 2, skipped: 2, failed: [], removed: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[0] as unknown[])[0]).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    const first = body(fetchFn.mock.calls[0]);
    expect(first).toEqual({ chat_id: 11, text: 'Algebra *bold* _x_ <b>hi</b>', disable_web_page_preview: true });
    expect(first.parse_mode).toBeUndefined();
    expect(body(fetchFn.mock.calls[1]).chat_id).toBe(33);
  });

  it.each([
    ['meeting_started', 'notify_meeting_started'],
    ['new_homework', 'notify_new_homework'],
    ['homework_reviewed', 'notify_homework_reviewed'],
    ['chat_message', 'notify_chat_message'],
    ['new_account', 'notify_new_account'],
    ['homework_submitted', 'notify_homework_submitted'],
    ['general_chat', 'notify_general_chat'],
  ] as const)('%s follows the %s switch', async (kind, column) => {
    const { client } = fakeClient([link('on', 1), link('off', 2, { [column]: false })]);
    const fetchFn = jest.fn(async () => ok());
    const result = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('on', kind), msg('off', kind)], clock());
    expect(result).toEqual({ sent: 1, skipped: 1, failed: [], removed: 0 });
  });

  it('no messages: no database or Telegram call', async () => {
    const { client, queried } = fakeClient([]);
    const fetchFn = jest.fn();
    expect(await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [], clock())).toEqual({
      sent: 0,
      skipped: 0,
      failed: [],
      removed: 0,
    });
    expect(queried).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('starts no more than 25 sends in any 1-second window', async () => {
    const users = Array.from({ length: 60 }, (_, i) => `u${i}`);
    const { client } = fakeClient(users.map((u, i) => link(u, i + 1)));
    const c = clock();
    const startedAt: number[] = [];
    const fetchFn = jest.fn(async () => {
      startedAt.push(c.now());
      return ok();
    });
    const result = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, users.map((u) => msg(u)), c);
    expect(result.sent).toBe(60);
    for (const t of startedAt) expect(startedAt.filter((s) => s > t - 1000 && s <= t).length).toBeLessThanOrEqual(25);
    expect(c.sleeps.length).toBeGreaterThan(0);
  });

  it('on 429 waits retry_after seconds, then sends', async () => {
    const { client } = fakeClient([link('a', 1)]);
    const c = clock();
    const fetchFn = jest.fn().mockResolvedValueOnce(err(429, 'Too Many Requests: retry after 3', 3)).mockResolvedValueOnce(ok());
    const result = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('a')], c);
    expect(result).toEqual({ sent: 1, skipped: 0, failed: [], removed: 0 });
    expect(c.sleeps).toContain(3000);
  });

  it('a 429 asking to wait past the time left is recorded as failed, without waiting', async () => {
    const { client } = fakeClient([link('a', 1)]);
    const c = clock();
    const fetchFn = jest.fn().mockResolvedValue(err(429, 'Too Many Requests: retry after 120', 120));
    const result = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('a')], { ...c, budgetMs: 50_000 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(c.sleeps).not.toContain(120_000);
    expect(result.failed).toEqual([{ userId: 'a', error: '429 Too Many Requests: retry after 120' }]);
  });

  it('retries 5xx and network errors, at most 3 tries, then reports the failure', async () => {
    const { client } = fakeClient([link('a', 1), link('b', 2)]);
    const fetchFn = jest
      .fn()
      // a: network error, then 502, then OK
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(err(502, 'Bad Gateway'))
      .mockResolvedValueOnce(ok())
      // b: 500 three times
      .mockResolvedValueOnce(err(500, 'Internal Server Error'))
      .mockResolvedValueOnce(err(500, 'Internal Server Error'))
      .mockResolvedValueOnce(err(500, 'Internal Server Error'));
    const result = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('a'), msg('b')], clock());
    expect(fetchFn).toHaveBeenCalledTimes(6);
    expect(result).toEqual({ sent: 1, skipped: 0, failed: [{ userId: 'b', error: '500 Internal Server Error' }], removed: 0 });
  });

  it('a 429 counts toward the same 3 tries', async () => {
    const { client } = fakeClient([link('a', 1)]);
    const fetchFn = jest.fn().mockResolvedValue(err(429, 'Too Many Requests', 1));
    const result = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('a')], clock());
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.failed).toHaveLength(1);
  });

  it('a 400 is not retried', async () => {
    const { client } = fakeClient([link('a', 1)]);
    const fetchFn = jest.fn().mockResolvedValue(err(400, 'Bad Request: chat not found'));
    const result = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('a')], clock());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.failed).toEqual([{ userId: 'a', error: '400 Bad Request: chat not found' }]);
  });

  it('on 403 (blocked) deletes that link, once, and skips the user\'s later messages', async () => {
    const { client, deleted } = fakeClient([link('a', 7), link('b', 8)]);
    const fetchFn = jest.fn().mockResolvedValueOnce(err(403, 'Forbidden: bot was blocked by the user')).mockResolvedValue(ok());
    const result = await sendTelegramMessages(
      client,
      'T',
      fetchFn as unknown as typeof fetch,
      [msg('a'), msg('a', 'new_homework'), msg('b')],
      clock(),
    );
    expect(deleted).toEqual([
      [
        ['user_id', 'a'],
        ['chat_id', 7],
      ],
    ]);
    expect(result).toEqual({
      sent: 1,
      skipped: 1,
      failed: [{ userId: 'a', error: '403 Forbidden: bot was blocked by the user' }],
      removed: 1,
    });
  });

  it('a database error fails every message without calling Telegram', async () => {
    const client = {
      from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'db down' } }) }) }),
    } as unknown as ServiceClient;
    const fetchFn = jest.fn();
    const result = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('a'), msg('b')], clock());
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.failed).toEqual([
      { userId: 'a', error: 'db down' },
      { userId: 'b', error: 'db down' },
    ]);
  });
});
