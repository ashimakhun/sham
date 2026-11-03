/**
 * @jest-environment node
 */
// QA ARU-49: gaps in homework-reviewed.test.ts: near-miss Authorization values (case, spacing, same-length wrong
// secret, the secret of another function), bodies that are JSON but not an object with a uuid, extra body fields
// ignored, the secret never logged, and the message never carrying the mentor's comment or anything but the title.
import { handleHomeworkReviewedRequest, type HomeworkRecipient, type HomeworkReviewedDeps } from './homework-reviewed';
import type { SendResult, TelegramMessage } from './telegram';

const SECRET = 'hw-secret-123';
const HW = '0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d';
const ok: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };
const post = (body: unknown, authorization: string | null = `Bearer ${SECRET}`) =>
  new Request('https://x.supabase.co/functions/v1/homework-reviewed-notifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization === null ? {} : { authorization }) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function deps(rows: HomeworkRecipient[] = [{ course_title: 'Algebra', user_id: 'S1' }]) {
  const sent: TelegramMessage[][] = [];
  const logs: string[] = [];
  const d: HomeworkReviewedDeps = {
    recipient: jest.fn(async () => rows),
    send: jest.fn(async (messages: TelegramMessage[]) => {
      sent.push(messages);
      return { ...ok, sent: messages.length };
    }),
    log: (line) => logs.push(line),
  };
  return { d, sent, logs };
}

describe('AC7: near-miss Authorization values are refused before any lookup', () => {
  it.each([
    ['lower-case scheme', `bearer ${SECRET}`],
    ['two spaces', `Bearer  ${SECRET}`],
    ['same length, last char wrong', `Bearer ${SECRET.slice(0, -1)}4`],
    ['a prefix of the secret', `Bearer ${SECRET.slice(0, 5)}`],
    ['the secret plus more', `Bearer ${SECRET}x`],
    ['the cron secret of another function', 'Bearer some-other-functions-secret'],
    ['an empty header', ''],
  ])('%s: 401', async (_n, authorization) => {
    const { d } = deps();
    const res = await handleHomeworkReviewedRequest(post({ homework_id: HW }, authorization), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.recipient).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('AC7: bodies that are not {"homework_id": "<uuid>"}', () => {
  it.each([
    ['JSON null', 'null'],
    ['a JSON array', JSON.stringify([HW])],
    ['a bare uuid string', JSON.stringify(HW)],
    ['a number id', JSON.stringify({ homework_id: 42 })],
    ['a uuid with spaces', JSON.stringify({ homework_id: ` ${HW} ` })],
    ['an id with SQL in it', JSON.stringify({ homework_id: `${HW}'; drop table homework; --` })],
    ['an empty body', ''],
    ['a camelCase key', JSON.stringify({ homeworkId: HW })],
  ])('%s: 400, nothing looked up or sent', async (_n, body) => {
    const { d } = deps();
    const res = await handleHomeworkReviewedRequest(post(body), SECRET, d);
    expect(res.status).toBe(400);
    expect(d.recipient).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('extra fields are ignored: only the id is used, and the text comes from the lookup', async () => {
    const { d, sent } = deps([{ course_title: 'Algebra', user_id: 'S1' }]);
    const body = { homework_id: HW.toUpperCase(), user_id: 'ATTACKER', text: 'Click http://evil', course_title: 'X' };
    const res = await handleHomeworkReviewedRequest(post(body), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.recipient).toHaveBeenCalledWith(HW.toUpperCase());
    expect(sent).toEqual([[{ userId: 'S1', kind: 'homework_reviewed', text: 'Your homework for Algebra was reviewed' }]]);
  });
});

describe('privacy', () => {
  it('the message is only the title sentence: no comment, checker or grade', async () => {
    const { d, sent } = deps([{ course_title: 'Biology', user_id: 'S2' }]);
    await handleHomeworkReviewedRequest(post({ homework_id: HW, mentor_comment: 'Great job' }), SECRET, d);
    expect(sent[0][0].text).toBe('Your homework for Biology was reviewed');
  });

  it('the secret is never written to the log, on success or on a 400', async () => {
    const a = deps();
    await handleHomeworkReviewedRequest(post({ homework_id: HW }), SECRET, a.d);
    const b = deps();
    await handleHomeworkReviewedRequest(post('not json'), SECRET, b.d);
    const c = deps();
    c.d.recipient = jest.fn(async () => {
      throw new Error('boom');
    });
    await handleHomeworkReviewedRequest(post({ homework_id: HW }), SECRET, c.d);
    for (const logs of [a.logs, b.logs, c.logs]) {
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain(SECRET);
    }
  });

  it('a 401 response body does not echo the secret or the header given', async () => {
    const { d } = deps();
    const res = await handleHomeworkReviewedRequest(post({ homework_id: HW }, `Bearer ${SECRET}x`), SECRET, d);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
  });
});

it('edge: the same homework posted twice (pg_net retry or replay) sends twice; nothing de-duplicates', async () => {
  // Documents current behaviour: each call is independent (the trigger only queues one per transition).
  const { d, sent } = deps();
  await handleHomeworkReviewedRequest(post({ homework_id: HW }), SECRET, d);
  await handleHomeworkReviewedRequest(post({ homework_id: HW }), SECRET, d);
  expect(sent).toHaveLength(2);
});
