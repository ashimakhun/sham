/**
 * @jest-environment node
 */
// ARU-48 AC 2, 3, 7: the bot's webhook and update handling, with the database functions and replies mocked.
import { CONNECTED, DISCONNECTED, EXPIRED, handleTelegramUpdate, handleTelegramWebhook, type BotDeps } from './telegram-bot';

const SECRET = 'sekret_123';
const deps = (name: string | null = 'Student Sam') => {
  const d = {
    linkChat: jest.fn(async () => name),
    unlinkChat: jest.fn(async () => {}),
    reply: jest.fn(async () => {}),
    log: jest.fn(),
  };
  return d as typeof d & BotDeps;
};
const update = (text: string, type = 'private', chatId = 42) => ({ update_id: 1, message: { text, chat: { id: chatId, type } } });
const request = (body: unknown, secret: string | null = SECRET, method = 'POST') =>
  new Request('https://example.test/telegram-webhook', {
    method,
    headers: { 'content-type': 'application/json', ...(secret !== null ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

describe('/start (AC 2, 3)', () => {
  it('a good code links the chat and confirms with the name', async () => {
    const d = deps('Student Sam');
    await handleTelegramUpdate(update('/start abc_DEF-123'), d);
    expect(d.linkChat).toHaveBeenCalledWith('abc_DEF-123', 42);
    expect(d.reply).toHaveBeenCalledWith(42, "Connected to Sham as Student Sam. You'll get your notifications here. Send /stop to disconnect.");
    expect(CONNECTED('X')).toContain('Connected to Sham as X.');
  });

  it('an unknown, used or old code (the database says null) gets the expired reply', async () => {
    const d = deps(null);
    await handleTelegramUpdate(update('/start oldcode'), d);
    expect(d.reply).toHaveBeenCalledWith(42, 'This link has expired. Open Sham → Profile → Connect Telegram to get a new one.');
    expect(EXPIRED).toBe('This link has expired. Open Sham → Profile → Connect Telegram to get a new one.');
  });

  it.each(['/start', '/start   ', '/start bad!code', `/start ${'x'.repeat(65)}`])(
    '%j gets the expired reply without a database call',
    async (text) => {
      const d = deps();
      await handleTelegramUpdate(update(text), d);
      expect(d.linkChat).not.toHaveBeenCalled();
      expect(d.reply).toHaveBeenCalledWith(42, EXPIRED);
    },
  );

  it('/start@SomeBot code also works', async () => {
    const d = deps();
    await handleTelegramUpdate(update('/start@ShamBot code1'), d);
    expect(d.linkChat).toHaveBeenCalledWith('code1', 42);
  });
});

describe('/stop (AC 7)', () => {
  it('unlinks the chat and confirms (also when it wasn\'t linked)', async () => {
    const d = deps();
    await handleTelegramUpdate(update('/stop'), d);
    expect(d.unlinkChat).toHaveBeenCalledWith(42);
    expect(d.reply).toHaveBeenCalledWith(42, "Disconnected. You won't get Sham notifications here.");
    expect(DISCONNECTED).toBe("Disconnected. You won't get Sham notifications here.");
  });
});

describe('ignored updates', () => {
  it.each(['group', 'supergroup', 'channel'])('a %s chat is ignored entirely', async (type) => {
    const d = deps();
    await handleTelegramUpdate(update('/start code1', type), d);
    await handleTelegramUpdate(update('/stop', type), d);
    expect(d.linkChat).not.toHaveBeenCalled();
    expect(d.unlinkChat).not.toHaveBeenCalled();
    expect(d.reply).not.toHaveBeenCalled();
  });

  it.each([
    ['other text', update('hello')],
    ['another command', update('/help')],
    ['an edited message', { update_id: 1, edited_message: { text: '/start code1', chat: { id: 42, type: 'private' } } }],
    ['a callback', { update_id: 1, callback_query: { id: 'x' } }],
    ['no text', { update_id: 1, message: { chat: { id: 42, type: 'private' } } }],
  ])('%s: no reply, no database call', async (_l, u) => {
    const d = deps();
    await handleTelegramUpdate(u as never, d);
    expect(d.reply).not.toHaveBeenCalled();
    expect(d.linkChat).not.toHaveBeenCalled();
    expect(d.unlinkChat).not.toHaveBeenCalled();
  });
});

describe('webhook', () => {
  it.each([
    ['missing', null],
    ['wrong', 'nope'],
    ['empty', ''],
  ])('a %s secret is rejected (401) and nothing runs', async (_l, secret) => {
    const d = deps();
    const res = await handleTelegramWebhook(request(update('/start code1'), secret), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.linkChat).not.toHaveBeenCalled();
  });

  it('no secret configured: everything is rejected', async () => {
    const res = await handleTelegramWebhook(request(update('/stop'), ''), '', deps());
    expect(res.status).toBe(401);
  });

  it('a non-POST request is refused', async () => {
    const res = await handleTelegramWebhook(request(null, SECRET, 'GET'), SECRET, deps());
    expect(res.status).toBe(405);
  });

  it('with the right secret: handles the update and answers 200', async () => {
    const d = deps();
    const res = await handleTelegramWebhook(request(update('/start code1')), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.linkChat).toHaveBeenCalledWith('code1', 42);
  });

  it('answers 200 even when handling fails, so Telegram does not redeliver', async () => {
    const d = deps();
    d.linkChat.mockRejectedValueOnce(new Error('db down'));
    const res = await handleTelegramWebhook(request(update('/start code1')), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.log).toHaveBeenCalledWith('telegram update failed: db down');
  });

  it('answers 200 for a body that is not JSON', async () => {
    const res = await handleTelegramWebhook(request('not json'), SECRET, deps());
    expect(res.status).toBe(200);
  });
});
