/**
 * @jest-environment node
 */
// QA ARU-48: gaps in telegram.test.ts and telegram-bot.test.ts: Markdown/HTML characters arrive verbatim (no
// parse_mode at all), a 5xx with a non-JSON body, a 403 that removes the link mid-batch while other users keep getting
// theirs, the exact return shape, and bot updates the ACs don't name (too-long codes, edits, photos, a wrong secret).
import { CONNECTED, DISCONNECTED, EXPIRED, handleTelegramUpdate, handleTelegramWebhook, type BotDeps } from './telegram-bot';
import { sendTelegramMessages, type ServiceClient, type TelegramMessage } from './telegram';

type Link = Record<string, unknown> & { user_id: string; chat_id: number };
const link = (userId: string, chatId: number, over: Record<string, boolean> = {}): Link => ({
  user_id: userId,
  chat_id: chatId,
  notify_meeting_started: true,
  notify_new_homework: true,
  notify_homework_reviewed: true,
  notify_chat_message: true,
  ...over,
});
function fakeClient(links: Link[]) {
  const deleted: unknown[][] = [];
  const client: ServiceClient = {
    from: () => ({
      select: () => ({ in: (_c: string, ids: string[]) => Promise.resolve({ data: links.filter((l) => ids.includes(l.user_id)), error: null }) }),
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (c2: string, v2: unknown) => {
            deleted.push([c1, v1, c2, v2]);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  };
  return { client, deleted };
}
function clock() {
  let t = 5_000_000;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const msg = (userId: string, text = 'Hi', kind: TelegramMessage['kind'] = 'chat_message'): TelegramMessage => ({ userId, kind, text });
const sentBody = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

describe('helper (AC 10)', () => {
  it('Markdown and HTML characters are sent exactly as given, with no parse_mode', async () => {
    const { client } = fakeClient([link('u1', 11)]);
    const fetchFn = jest.fn(async () => ok());
    const text = 'Course *Algebra_2* <b>new</b> [link](x) `code` & 50%';
    const res = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('u1', text)], clock());
    expect(res).toEqual({ sent: 1, skipped: 0, failed: [], removed: 0 });
    const body = sentBody(fetchFn.mock.calls[0]);
    expect(body.text).toBe(text);
    expect(body).not.toHaveProperty('parse_mode');
    expect(body.chat_id).toBe(11);
  });

  it('a 5xx with an HTML (non-JSON) body is retried and reported with its status', async () => {
    const { client } = fakeClient([link('u1', 11)]);
    const fetchFn = jest.fn(async () => new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }));
    const res = await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('u1')], clock());
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(res.sent).toBe(0);
    expect(res.failed).toEqual([{ userId: 'u1', error: expect.stringMatching(/^502/) }]);
  });

  it('a 403 for one user removes only that link; the others in the batch still get theirs', async () => {
    const { client, deleted } = fakeClient([link('u1', 11), link('u2', 22), link('u3', 33, { notify_chat_message: false })]);
    const fetchFn = jest.fn(async (_url: string, init: RequestInit) =>
      JSON.parse(init.body as string).chat_id === 11
        ? new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), { status: 403 })
        : ok(),
    );
    const res = await sendTelegramMessages(
      client,
      'T',
      fetchFn as unknown as typeof fetch,
      [msg('u1'), msg('u2'), msg('u1', 'again'), msg('u3'), msg('nobody')],
      clock(),
    );
    expect(deleted).toEqual([['user_id', 'u1', 'chat_id', 11]]);
    expect(res.sent).toBe(1);
    expect(res.removed).toBe(1);
    // u1's second message, u3 (switch off) and the unlinked user are skipped.
    expect(res.skipped).toBe(3);
    expect(res.failed).toEqual([{ userId: 'u1', error: expect.stringMatching(/^403/) }]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('two messages to the same user are both sent, in order', async () => {
    const { client } = fakeClient([link('u1', 11)]);
    const fetchFn = jest.fn(async () => ok());
    await sendTelegramMessages(client, 'T', fetchFn as unknown as typeof fetch, [msg('u1', 'first'), msg('u1', 'second')], clock());
    expect(fetchFn.mock.calls.map((c) => sentBody(c).text)).toEqual(['first', 'second']);
  });

  it('each kind uses its own switch', async () => {
    const { client } = fakeClient([link('u1', 11, { notify_meeting_started: false, notify_homework_reviewed: false })]);
    const fetchFn = jest.fn(async () => ok());
    const res = await sendTelegramMessages(
      client,
      'T',
      fetchFn as unknown as typeof fetch,
      [msg('u1', 'a', 'meeting_started'), msg('u1', 'b', 'new_homework'), msg('u1', 'c', 'homework_reviewed'), msg('u1', 'd', 'chat_message')],
      clock(),
    );
    expect(fetchFn.mock.calls.map((c) => sentBody(c).text)).toEqual(['b', 'd']);
    expect(res).toEqual({ sent: 2, skipped: 2, failed: [], removed: 0 });
  });
});

describe('bot (AC 2, 3, 7)', () => {
  const deps = (name: string | null = 'Student Sam') => {
    const d = { linkChat: jest.fn(async () => name), unlinkChat: jest.fn(async () => {}), reply: jest.fn(async () => {}), log: jest.fn() };
    return d as typeof d & BotDeps;
  };
  const priv = (message: Record<string, unknown>) => ({ update_id: 1, message: { chat: { id: 7, type: 'private' }, ...message } });

  it('a code longer than 64 characters or with other characters is refused without asking the database', async () => {
    for (const code of ['a'.repeat(65), 'abc$def', 'abc.def']) {
      const d = deps();
      await handleTelegramUpdate(priv({ text: `/start ${code}` }), d);
      expect(d.linkChat).not.toHaveBeenCalled();
      expect(d.reply).toHaveBeenCalledWith(7, EXPIRED);
    }
  });

  it('a 64-character code is passed through, and spaces around it are fine', async () => {
    const d = deps();
    await handleTelegramUpdate(priv({ text: `  /start ${'A'.repeat(64)}  ` }), d);
    expect(d.linkChat).toHaveBeenCalledWith('A'.repeat(64), 7);
    expect(d.reply).toHaveBeenCalledWith(7, CONNECTED('Student Sam'));
  });

  it('"/start code extra" links nothing (treated as other text: no reply)', async () => {
    const d = deps();
    await handleTelegramUpdate(priv({ text: '/start abc def' }), d);
    expect(d.linkChat).not.toHaveBeenCalled();
    expect(d.unlinkChat).not.toHaveBeenCalled();
  });

  it('a photo, an edited message, a callback, other text and "/stopit" get no reply and change nothing', async () => {
    const d = deps();
    await handleTelegramUpdate(priv({ photo: [{ file_id: 'x' }] }), d);
    await handleTelegramUpdate({ update_id: 2, edited_message: { text: '/stop', chat: { id: 7, type: 'private' } } } as never, d);
    await handleTelegramUpdate({ update_id: 3, callback_query: { id: 'q' } } as never, d);
    await handleTelegramUpdate(priv({ text: 'hello' }), d);
    await handleTelegramUpdate(priv({ text: '/stopit' }), d);
    expect(d.linkChat).not.toHaveBeenCalled();
    expect(d.unlinkChat).not.toHaveBeenCalled();
    expect(d.reply).not.toHaveBeenCalled();
  });

  it('/stop replies "Disconnected" with the exact text', async () => {
    const d = deps();
    await handleTelegramUpdate(priv({ text: '/stop' }), d);
    expect(d.unlinkChat).toHaveBeenCalledWith(7);
    expect(d.reply).toHaveBeenCalledWith(7, DISCONNECTED);
    expect(DISCONNECTED).toBe("Disconnected. You won't get Sham notifications here.");
    expect(EXPIRED).toBe('This link has expired. Open Sham → Profile → Connect Telegram to get a new one.');
    expect(CONNECTED('Sam')).toBe("Connected to Sham as Sam. You'll get your notifications here. Send /stop to disconnect.");
  });

  it('a wrong secret of the same length, or a missing header, is rejected and nothing runs', async () => {
    for (const given of ['sekret_124', null]) {
      const d = deps();
      const req = new Request('https://x.test/telegram-webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(given ? { 'x-telegram-bot-api-secret-token': given } : {}) },
        body: JSON.stringify(priv({ text: '/stop' })),
      });
      const res = await handleTelegramWebhook(req, 'sekret_123', d);
      expect(res.status).toBe(401);
      expect(d.unlinkChat).not.toHaveBeenCalled();
    }
  });

  it('a failing reply after linking is logged, and Telegram still gets 200', async () => {
    const d = deps();
    d.reply.mockRejectedValueOnce(new Error('Telegram sendMessage failed: 400 Bad Request'));
    const req = new Request('https://x.test/telegram-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'sekret_123' },
      body: JSON.stringify(priv({ text: '/start abc' })),
    });
    const res = await handleTelegramWebhook(req, 'sekret_123', d);
    expect(res.status).toBe(200);
    expect(d.linkChat).toHaveBeenCalledWith('abc', 7);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('400'));
  });
});
