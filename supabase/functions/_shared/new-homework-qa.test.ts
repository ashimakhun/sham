/**
 * @jest-environment node
 */
// QA ARU-50: gaps in new-homework.test.ts: a same-length wrong bearer, extra spaces, the secret only in the query
// string, an upper-case uuid, special characters and a long title kept as typed, two recipients in one helper call
// with their own course titles, and the secret never logged.
import { handleNewHomeworkRequest, type NewHomeworkDeps, type NewHomeworkRecipient } from './new-homework';
import type { TelegramMessage } from './telegram';

const SECRET = 'top-secret-value';
const ID = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function call(body: unknown, auth: string | null, url = 'https://x.test/functions/v1/new-homework-notifications') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== null) headers.authorization = auth;
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

function deps(rows: NewHomeworkRecipient[]) {
  const logs: string[] = [];
  const sent: TelegramMessage[][] = [];
  const d: NewHomeworkDeps = {
    recipients: jest.fn(async () => rows),
    send: jest.fn(async (messages: TelegramMessage[]) => {
      sent.push(messages);
      return { sent: messages.length, skipped: 0, failed: [], removed: 0 };
    }),
    log: (line) => logs.push(line),
  };
  return { d, logs, sent };
}

describe('AC 8: secret check', () => {
  it.each([
    ['a same-length wrong secret', `Bearer ${'x'.repeat(SECRET.length)}`],
    ['two spaces after Bearer', `Bearer  ${SECRET}`],
    ['a prefix of the secret', `Bearer ${SECRET.slice(0, -1)}`],
  ])('answers 401 and does nothing for %s', async (_, auth) => {
    const { d, logs } = deps([{ course_title: 'Algebra', user_id: 'u1' }]);
    const res = await handleNewHomeworkRequest(call({ assignment_id: ID }, auth), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.recipients).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it('answers 401 when the secret is only in the query string', async () => {
    const { d } = deps([{ course_title: 'Algebra', user_id: 'u1' }]);
    const res = await handleNewHomeworkRequest(
      call({ assignment_id: ID }, null, `https://x.test/functions/v1/new-homework-notifications?secret=${SECRET}`),
      SECRET,
      d,
    );
    expect(res.status).toBe(401);
    expect(d.send).not.toHaveBeenCalled();
  });
});

it('AC 8: an upper-case uuid is accepted and passed on', async () => {
  const { d } = deps([]);
  const res = await handleNewHomeworkRequest(call({ assignment_id: ID.toUpperCase() }, `Bearer ${SECRET}`), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.recipients).toHaveBeenCalledWith(ID.toUpperCase());
});

it('AC 1 / AC 8 / edge: one helper call, one plain message per recipient, special characters and long titles as typed', async () => {
  const long = 'Алгебра '.repeat(40).trim();
  const { d, sent } = deps([
    { course_title: 'Math *bold* _x_ <b>&amp;', user_id: 'u1' },
    { course_title: long, user_id: 'u2' },
  ]);
  const res = await handleNewHomeworkRequest(call({ assignment_id: ID }, `Bearer ${SECRET}`), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(sent[0]).toEqual([
    { userId: 'u1', kind: 'new_homework', text: 'New homework assigned to you in Math *bold* _x_ <b>&amp;' },
    { userId: 'u2', kind: 'new_homework', text: `New homework assigned to you in ${long}` },
  ]);
  expect(await res.json()).toEqual({ recipients: 2, sent: 2, skipped: 0, failed: [], removed: 0 });
});

it('AC 8: the secret never appears in the logs or the response', async () => {
  const { d, logs } = deps([{ course_title: 'Algebra', user_id: 'u1' }]);
  const res = await handleNewHomeworkRequest(call({ assignment_id: ID }, `Bearer ${SECRET}`), SECRET, d);
  expect(logs.join('\n')).not.toContain(SECRET);
  expect(await res.text()).not.toContain(SECRET);
});
