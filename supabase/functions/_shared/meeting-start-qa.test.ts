/**
 * @jest-environment node
 */
// QA ARU-41: gaps in meeting-start.test.ts: a same-length wrong secret, the secret in another header or the query
// string, a GET with the right secret (nothing claimed), a listener in two meetings at once, a claimed meeting whose
// listener list comes back null, and the report a run returns.
import { type ClaimedMeeting, handleMeetingStartRequest, meetingStartMessages, type MeetingStartDeps } from './meeting-start';
import type { SendResult, TelegramMessage } from './telegram';

const SECRET = 'cron-secret-123';
const url = 'https://x.supabase.co/functions/v1/meeting-start-notifications';

function deps(meetings: ClaimedMeeting[]) {
  const d: MeetingStartDeps = {
    claim: jest.fn(async () => meetings),
    send: jest.fn(async (messages: TelegramMessage[]): Promise<SendResult> => ({
      sent: messages.length - 1,
      skipped: 1,
      failed: [],
      removed: 0,
    })),
    log: jest.fn(),
  };
  return d;
}

it.each([
  ['a same-length wrong secret', { 'x-cron-secret': 'cron-secret-124' }, url],
  ['the secret as a bearer token', { authorization: `Bearer ${SECRET}` }, url],
  ['the secret in the query string', {}, `${url}?x-cron-secret=${SECRET}`],
])('AC 9: %s gets 401 and claims nothing', async (_k, headers, target) => {
  const d = deps([{ meeting_id: 'm1', course_title: 'A', listener_ids: ['S1'] }]);
  const res = await handleMeetingStartRequest(new Request(target, { method: 'POST', headers, body: '{}' }), SECRET, d);
  expect(res.status).toBe(401);
  expect(d.claim).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('AC 9: a GET with the right secret claims nothing', async () => {
  const d = deps([{ meeting_id: 'm1', course_title: 'A', listener_ids: ['S1'] }]);
  const res = await handleMeetingStartRequest(new Request(url, { method: 'GET', headers: { 'x-cron-secret': SECRET } }), SECRET, d);
  expect(res.status).not.toBe(200);
  expect(d.claim).not.toHaveBeenCalled();
});

it('AC 8: a listener in two courses starting at once gets one message per meeting, each with its title', () => {
  const messages = meetingStartMessages([
    { meeting_id: 'm1', course_title: 'Algebra', listener_ids: ['S1', 'M2'] },
    { meeting_id: 'm2', course_title: 'Biology', listener_ids: ['S1'] },
  ]);
  expect(messages).toEqual([
    { userId: 'S1', kind: 'meeting_started', text: 'Algebra meeting has started' },
    { userId: 'M2', kind: 'meeting_started', text: 'Algebra meeting has started' },
    { userId: 'S1', kind: 'meeting_started', text: 'Biology meeting has started' },
  ]);
});

it('a claimed meeting whose listener list is null sends nothing but is counted', async () => {
  const d = deps([{ meeting_id: 'm1', course_title: 'Empty', listener_ids: null }]);
  const res = await handleMeetingStartRequest(new Request(url, { method: 'POST', headers: { 'x-cron-secret': SECRET } }), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.send).not.toHaveBeenCalled();
  expect(await res.json()).toEqual({ meetings: 1, sent: 0, skipped: 0, failed: [], removed: 0 });
});

it('AC 3 logging: the run returns and logs the counts from the helper', async () => {
  const d = deps([{ meeting_id: 'm1', course_title: 'A', listener_ids: ['S1', 'S2', 'S3'] }]);
  const res = await handleMeetingStartRequest(new Request(url, { method: 'POST', headers: { 'x-cron-secret': SECRET } }), SECRET, d);
  expect(await res.json()).toEqual({ meetings: 1, sent: 2, skipped: 1, failed: [], removed: 0 });
  expect(d.log).toHaveBeenCalledWith(expect.stringMatching(/1 meeting\(s\), sent 2, skipped 1, removed 0, failed 0/));
});
