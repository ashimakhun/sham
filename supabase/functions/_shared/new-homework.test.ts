/**
 * @jest-environment node
 */
// ARU-50 AC 8 / AC 11: the new-homework-notifications function's logic, with the database and the helper mocked, and
// once end to end through the real ARU-48 helper with fetch and the service-role client mocked.
import {
  handleNewHomeworkRequest,
  newHomeworkMessages,
  newHomeworkText,
  type NewHomeworkDeps,
  type NewHomeworkRecipient,
} from './new-homework';
import { sendTelegramMessages, type SendResult, type ServiceClient, type TelegramMessage } from './telegram';

const SECRET = 'top-secret-value';
const ID = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function request(body: unknown, auth: string | null = `Bearer ${SECRET}`, method = 'POST') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== null) headers.authorization = auth;
  return new Request('https://x.test/functions/v1/new-homework-notifications', {
    method,
    headers,
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function deps(rows: NewHomeworkRecipient[] = [], result?: Partial<SendResult>) {
  const logs: string[] = [];
  const sent: TelegramMessage[][] = [];
  const asked: string[] = [];
  const d: NewHomeworkDeps = {
    recipients: jest.fn(async (id: string) => {
      asked.push(id);
      return rows;
    }),
    send: jest.fn(async (messages: TelegramMessage[]) => {
      sent.push(messages);
      return { sent: messages.length, skipped: 0, failed: [], removed: 0, ...result };
    }),
    log: (line) => logs.push(line),
  };
  return { d, logs, sent, asked };
}

const algebra = (userId: string): NewHomeworkRecipient => ({ course_title: 'Algebra 101', user_id: userId });

describe('newHomeworkText / newHomeworkMessages', () => {
  it('uses the exact text, plain', () => {
    expect(newHomeworkText('Algebra 101')).toBe('New homework assigned to you in Algebra 101');
    expect(newHomeworkText('*Bold* _x_ <b>')).toBe('New homework assigned to you in *Bold* _x_ <b>');
  });
  it('makes one new_homework message per recipient', () => {
    expect(newHomeworkMessages([algebra('u1'), algebra('u2')])).toEqual([
      { userId: 'u1', kind: 'new_homework', text: 'New homework assigned to you in Algebra 101' },
      { userId: 'u2', kind: 'new_homework', text: 'New homework assigned to you in Algebra 101' },
    ]);
    expect(newHomeworkMessages([])).toEqual([]);
  });
});

describe('handleNewHomeworkRequest', () => {
  it.each([
    ['missing', null],
    ['wrong', 'Bearer nope'],
    ['without Bearer', SECRET],
    ['lower-case bearer', `bearer ${SECRET}`],
    ['empty', ''],
  ])('answers 401 and does nothing when the Authorization header is %s', async (_, auth) => {
    const { d, logs } = deps([algebra('u1')]);
    const res = await handleNewHomeworkRequest(request({ assignment_id: ID }, auth), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.recipients).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it('answers 401 when the function has no secret configured, even to an empty bearer', async () => {
    const { d } = deps([algebra('u1')]);
    const res = await handleNewHomeworkRequest(request({ assignment_id: ID }, 'Bearer '), '', d);
    expect(res.status).toBe(401);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('answers 405 to anything but POST', async () => {
    const { d } = deps([algebra('u1')]);
    const res = await handleNewHomeworkRequest(request(null, `Bearer ${SECRET}`, 'GET'), SECRET, d);
    expect(res.status).toBe(405);
    expect(d.send).not.toHaveBeenCalled();
  });

  it.each([
    ['bad JSON', '{not json'],
    ['no assignment_id', {}],
    ['assignment_id not a uuid', { assignment_id: 'abc' }],
    ['assignment_id a number', { assignment_id: 42 }],
    ['null body', 'null'],
  ])('answers 400 and sends nothing for %s', async (_, body) => {
    const { d, logs } = deps([algebra('u1')]);
    const res = await handleNewHomeworkRequest(request(body), SECRET, d);
    expect(res.status).toBe(400);
    expect(d.recipients).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it('sends one message per recipient in a single helper call and logs the result', async () => {
    const { d, logs, sent, asked } = deps([algebra('u1'), algebra('u2')], { sent: 1, skipped: 1 });
    const res = await handleNewHomeworkRequest(request({ assignment_id: ID }), SECRET, d);
    expect(res.status).toBe(200);
    expect(asked).toEqual([ID]);
    expect(sent).toEqual([
      [
        { userId: 'u1', kind: 'new_homework', text: 'New homework assigned to you in Algebra 101' },
        { userId: 'u2', kind: 'new_homework', text: 'New homework assigned to you in Algebra 101' },
      ],
    ]);
    expect(await res.json()).toEqual({ recipients: 2, sent: 1, skipped: 1, failed: [], removed: 0 });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(ID);
    expect(logs[0]).toContain('2 recipient(s), sent 1, skipped 1, removed 0, failed 0');
    expect(logs[0]).not.toContain(SECRET);
  });

  it('logs failed sends and still answers 200 (they are dropped, not retried)', async () => {
    const { d, logs } = deps([algebra('u1')], { sent: 0, failed: [{ userId: 'u1', error: '500 down' }] });
    const res = await handleNewHomeworkRequest(request({ assignment_id: ID }), SECRET, d);
    expect(res.status).toBe(200);
    expect(logs[0]).toContain('failed 1 (u1: 500 down)');
  });

  it('sends nothing when there are no recipients', async () => {
    const { d, logs } = deps([]);
    const res = await handleNewHomeworkRequest(request({ assignment_id: ID }), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ recipients: 0, sent: 0, skipped: 0, failed: [], removed: 0 });
    expect(logs[0]).toContain('0 recipient(s)');
  });

  it('answers 500 and sends nothing when the recipient lookup fails', async () => {
    const { d, logs } = deps([]);
    d.recipients = jest.fn(async () => {
      throw new Error('db down');
    });
    const res = await handleNewHomeworkRequest(request({ assignment_id: ID }), SECRET, d);
    expect(res.status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
    expect(logs[0]).toContain('db down');
  });

  it('end to end with the real helper: only linked listeners with New homework on get the text', async () => {
    const links = [
      { user_id: 'u1', chat_id: 101, notify_new_homework: true },
      { user_id: 'u2', chat_id: 102, notify_new_homework: false },
    ];
    const client: ServiceClient = {
      from: () => ({
        select: () => ({
          in: (_column: string, ids: string[]) =>
            Promise.resolve({ data: links.filter((l) => ids.includes(l.user_id)), error: null }),
        }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
    };
    const fetchMock = jest.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const logs: string[] = [];
    const res = await handleNewHomeworkRequest(request({ assignment_id: ID }), SECRET, {
      recipients: async () => [algebra('u1'), algebra('u2'), algebra('u3')],
      send: (messages) =>
        sendTelegramMessages(client, 'TOKEN', fetchMock as unknown as typeof fetch, messages, {
          sleep: async () => {},
        }),
      log: (line) => logs.push(line),
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    const body = JSON.parse(String(init.body));
    expect(body.chat_id).toBe(101);
    expect(body.text).toBe('New homework assigned to you in Algebra 101');
    expect(body.parse_mode).toBeUndefined();
    expect(await res.json()).toMatchObject({ recipients: 3, sent: 1, skipped: 2 });
  });
});
