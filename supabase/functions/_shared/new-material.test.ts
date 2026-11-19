/**
 * @jest-environment node
 */
// ARU-102: the new-material-notifications function's logic, with the recipient lookup and the sending helper mocked
// (AC 1, 2, 8, 9), and once end to end with the real push sender and a mocked Expo push service (AC 5 switch).
import {
  handleNewMaterialRequest,
  type NewMaterialDeps,
  newMaterialMessages,
  type NewMaterialRecipient,
  newMaterialText,
} from './new-material';
import { type SendResult, type NotificationMessage } from './notification';
import { sendPushMessages } from './push';
import { pushClient, pushFetch } from './push-test-helpers';

const SECRET = 'mat-secret-123';
const ID = '3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const post = (
  body: unknown = { type: 'blog', id: ID },
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
  method = 'POST',
) =>
  new Request('https://x.supabase.co/functions/v1/new-material-notifications', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const ok: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

function deps(rows: NewMaterialRecipient[], result: Partial<SendResult> = {}) {
  const sent: NotificationMessage[][] = [];
  const logs: string[] = [];
  const d: NewMaterialDeps = {
    recipients: jest.fn(async () => rows),
    send: jest.fn(async (messages: NotificationMessage[]) => {
      sent.push(messages);
      return { ...ok, sent: messages.length, ...result };
    }),
    log: (line) => logs.push(line),
  };
  return { d, sent, logs };
}

const rows = (title: string): NewMaterialRecipient[] => [
  { user_id: 'T', author_name: 'Aigerim', item_title: title },
  { user_id: 'S1', author_name: 'Aigerim', item_title: title },
  { user_id: 'M2', author_name: 'Aigerim', item_title: title },
];
const BLOG = 'New blog post: Exam tips';
const FILE = 'New file in the knowledge base: Formulas.pdf';

describe('AC9: the secret', () => {
  it.each([
    ['no Authorization header', {}],
    ['a wrong secret', { authorization: 'Bearer nope' }],
    ['the secret without Bearer', { authorization: SECRET }],
  ])('%s: 401, nothing looked up or sent', async (_name, headers) => {
    const { d } = deps(rows('Exam tips'));
    const res = await handleNewMaterialRequest(post(undefined, headers), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.recipients).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('an empty configured secret refuses everyone', async () => {
    const { d } = deps(rows('Exam tips'));
    expect((await handleNewMaterialRequest(post(undefined, { authorization: 'Bearer ' }), '', d)).status).toBe(401);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('only POST', async () => {
    const { d } = deps(rows('Exam tips'));
    expect((await handleNewMaterialRequest(post(undefined, undefined, 'GET'), SECRET, d)).status).toBe(405);
  });
});

describe('AC1 / AC2: the messages', () => {
  it('texts are exactly as the story sets them, names and titles as typed', () => {
    expect(newMaterialText('blog', 'Aigerim', 'Exam tips')).toBe(BLOG);
    expect(newMaterialText('file', 'Aigerim', 'Formulas.pdf')).toBe(FILE);
    expect(newMaterialText('blog', 'Дана *_', '<b>T</b> & 😀')).toBe('New blog post: <b>T</b> & 😀');
  });

  it('a Blog post: one new_material message per recipient, in one send call', async () => {
    const { d, sent, logs } = deps(rows('Exam tips'));
    const res = await handleNewMaterialRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.recipients).toHaveBeenCalledWith('blog', ID);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      [
        { userId: 'T', kind: 'new_material', text: BLOG },
        { userId: 'S1', kind: 'new_material', text: BLOG },
        { userId: 'M2', kind: 'new_material', text: BLOG },
      ],
    ]);
    expect(await res.json()).toEqual({ recipients: 3, sent: 3, skipped: 0, failed: [], removed: 0 });
    expect(logs.join('\n')).toContain(`new-material: blog ${ID}: 3 recipient(s), sent 3`);
  });

  it('a Knowledge base PDF: the file text and kind new_material', async () => {
    const { d, sent } = deps(rows('Formulas.pdf'));
    const res = await handleNewMaterialRequest(post({ type: 'file', id: ID }), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.recipients).toHaveBeenCalledWith('file', ID);
    expect(sent[0].map((m) => [m.kind, m.text])).toEqual([
      ['new_material', FILE],
      ['new_material', FILE],
      ['new_material', FILE],
    ]);
  });

  it('one message per row', () => {
    expect(newMaterialMessages('file', rows('x')).map((m) => m.userId)).toEqual(['T', 'S1', 'M2']);
  });
});

describe('nothing to send / bad requests', () => {
  it('no recipients (nobody linked, deleted item, unknown id): 200, nothing sent', async () => {
    const { d } = deps([]);
    const res = await handleNewMaterialRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ recipients: 0, sent: 0, skipped: 0, failed: [], removed: 0 });
  });

  it.each([
    [{}],
    [{ type: 'blog' }],
    [{ id: ID }],
    [{ type: 'video', id: ID }],
    [{ type: 'blog', id: 'nope' }],
    ['not json'],
    [null],
  ])('bad body %p: 400, nothing looked up', async (body) => {
    const { d } = deps(rows('x'));
    expect((await handleNewMaterialRequest(post(body), SECRET, d)).status).toBe(400);
    expect(d.recipients).not.toHaveBeenCalled();
  });
});

describe('AC8: failures are logged and dropped', () => {
  it('the lookup failing: 500, nothing sent', async () => {
    const { d, logs } = deps(rows('x'));
    (d.recipients as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    expect((await handleNewMaterialRequest(post(), SECRET, d)).status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('recipient lookup failed: db down');
  });

  it('the helper throwing: 200 with every message reported failed', async () => {
    const { d } = deps(rows('x'));
    (d.send as jest.Mock).mockRejectedValueOnce(new Error('push down'));
    const res = await handleNewMaterialRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect((await res.json()).failed).toEqual([
      { userId: 'T', error: 'push down' },
      { userId: 'S1', error: 'push down' },
      { userId: 'M2', error: 'push down' },
    ]);
  });
});

describe('AC5: with the real push sender, the New materials switch decides', () => {
  function client(on: boolean) {
    const links = [
      { user_id: 'T', chat_id: 11, notify_general_chat: true, notify_new_material: true },
      { user_id: 'S1', chat_id: 12, notify_general_chat: true, notify_new_material: on },
    ];
    return pushClient(links).client;
  }
  const run = async (on: boolean) => {
    const fetchFn = pushFetch();
    const { d } = deps(rows('Exam tips').slice(0, 2));
    d.send = (messages) => sendPushMessages(client(on), fetchFn.fetch, messages);
    const res = await handleNewMaterialRequest(post(), SECRET, d);
    return { body: await res.json(), fetchFn };
  };

  it('on: both get it as plain text', async () => {
    const { body, fetchFn } = await run(true);
    expect(body).toMatchObject({ sent: 2, skipped: 0 });
    expect(fetchFn.sent()).toEqual([
      [11, BLOG],
      [12, BLOG],
    ]);
  });

  it('off for S1: S1 skipped, the teacher still gets it', async () => {
    const { body, fetchFn } = await run(false);
    expect(body).toMatchObject({ sent: 1, skipped: 1 });
    expect(fetchFn.mock).toHaveBeenCalledTimes(1);
  });
});
