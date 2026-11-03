/**
 * @jest-environment node
 */
// ARU-41: the meeting-start-notifications function's logic, with the claim and the sending helper mocked (AC 1, 3, 9),
// and once end to end with the real ARU-48 helper and a mocked Telegram (switch respected, plain text).
import {
  type ClaimedMeeting,
  handleMeetingStartRequest,
  meetingStartMessages,
  meetingStartedText,
  type MeetingStartDeps,
} from './meeting-start';
import { sendTelegramMessages, type SendResult, type ServiceClient, type TelegramMessage } from './telegram';

const SECRET = 'cron-secret-123';
const post = (headers: Record<string, string> = { 'x-cron-secret': SECRET }, method = 'POST') =>
  new Request('https://x.supabase.co/functions/v1/meeting-start-notifications', { method, headers, body: '{}' });
const ok: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

function deps(meetings: ClaimedMeeting[], result: Partial<SendResult> = {}) {
  const order: string[] = [];
  const sent: TelegramMessage[][] = [];
  const logs: string[] = [];
  const d: MeetingStartDeps = {
    claim: jest.fn(async () => {
      order.push('claim');
      return meetings;
    }),
    send: jest.fn(async (messages: TelegramMessage[]) => {
      order.push('send');
      sent.push(messages);
      return { ...ok, sent: messages.length, ...result };
    }),
    log: (line) => logs.push(line),
  };
  return { d, order, sent, logs };
}

const algebra: ClaimedMeeting = { meeting_id: 'm1', course_title: 'Algebra 101', listener_ids: ['S1', 'M2'] };

describe('AC9: the secret', () => {
  it.each([
    ['no secret', {}],
    ['a wrong secret', { 'x-cron-secret': 'nope' }],
    ['the secret in another header', { authorization: `Bearer ${SECRET}` }],
  ])('%s: 401, nothing claimed or sent', async (_name, headers) => {
    const { d } = deps([algebra]);
    const res = await handleMeetingStartRequest(post(headers), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('an empty configured secret refuses everyone', async () => {
    const { d } = deps([algebra]);
    const res = await handleMeetingStartRequest(post({ 'x-cron-secret': '' }), '', d);
    expect(res.status).toBe(401);
    expect(d.claim).not.toHaveBeenCalled();
  });

  it('only POST', async () => {
    const { d } = deps([algebra]);
    const res = await handleMeetingStartRequest(
      new Request('https://x/f', { method: 'GET', headers: { 'x-cron-secret': SECRET } }),
      SECRET,
      d,
    );
    expect(res.status).toBe(405);
    expect(d.claim).not.toHaveBeenCalled();
  });
});

describe('AC1 / AC3 / AC8: claim, then send', () => {
  it('claims first, then sends one meeting_started message per listener with the exact text', async () => {
    const { d, order, sent } = deps([algebra]);
    const res = await handleMeetingStartRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(order).toEqual(['claim', 'send']);
    expect(sent).toEqual([
      [
        { userId: 'S1', kind: 'meeting_started', text: 'Algebra 101 meeting has started' },
        { userId: 'M2', kind: 'meeting_started', text: 'Algebra 101 meeting has started' },
      ],
    ]);
    expect(await res.json()).toEqual({ meetings: 1, sent: 2, skipped: 0, failed: [], removed: 0 });
  });

  it('two meetings at once: one message per listener per meeting', () => {
    const messages = meetingStartMessages([
      algebra,
      { meeting_id: 'm2', course_title: 'Biology', listener_ids: ['S1'] },
      { meeting_id: 'm3', course_title: 'Algebra 101', listener_ids: ['S1'] },
    ]);
    expect(messages.map((m) => `${m.userId}:${m.text}`)).toEqual([
      'S1:Algebra 101 meeting has started',
      'M2:Algebra 101 meeting has started',
      'S1:Biology meeting has started',
      'S1:Algebra 101 meeting has started',
    ]);
  });

  it('special characters stay as typed', () => {
    expect(meetingStartedText('*Math_1* <A&B> 🧮')).toBe('*Math_1* <A&B> 🧮 meeting has started');
  });

  it('nothing claimed: nothing sent', async () => {
    const { d } = deps([]);
    const res = await handleMeetingStartRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ meetings: 0, sent: 0, skipped: 0, failed: [], removed: 0 });
  });

  it('a meeting with no listeners claims but sends nothing', async () => {
    const { d } = deps([{ meeting_id: 'm1', course_title: 'Empty', listener_ids: [] }]);
    const res = await handleMeetingStartRequest(post(), SECRET, d);
    expect(d.send).not.toHaveBeenCalled();
    expect((await res.json()).meetings).toBe(1);
  });

  it('a claim error: 500, nothing sent', async () => {
    const { d, logs } = deps([]);
    d.claim = jest.fn(async () => {
      throw new Error('permission denied');
    });
    const res = await handleMeetingStartRequest(post(), SECRET, d);
    expect(res.status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('permission denied');
  });

  it('AC3: failed messages are reported and logged, not retried by this run', async () => {
    const failed = [{ userId: 'M2', error: '500 Internal Server Error' }];
    const { d, logs } = deps([algebra], { sent: 1, failed });
    const res = await handleMeetingStartRequest(post(), SECRET, d);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect((await res.json()).failed).toEqual(failed);
    expect(logs.join('\n')).toMatch(/1 meeting\(s\), sent 1, skipped 0, removed 0, failed 1 \(M2: 500 Internal Server Error\)/);
  });
});

describe('end to end with the ARU-48 helper', () => {
  it('AC2: unlinked and switched-off listeners are skipped; the text goes out as plain text', async () => {
    const links = [
      { user_id: 'S1', chat_id: 11, notify_meeting_started: true },
      { user_id: 'M2', chat_id: 22, notify_meeting_started: false },
    ];
    const client = {
      from: () => ({
        select: () => ({
          in: (_c: string, ids: string[]) =>
            Promise.resolve({ data: links.filter((l) => ids.includes(l.user_id)), error: null }),
        }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
    } as unknown as ServiceClient;
    const fetchFn = jest.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await handleMeetingStartRequest(post(), SECRET, {
      claim: async () => [{ meeting_id: 'm1', course_title: 'Algebra *1*', listener_ids: ['S1', 'M2', 'S9'] }],
      send: (messages) => sendTelegramMessages(client, 'TOKEN', fetchFn as unknown as typeof fetch, messages, { sleep: async () => {} }),
    });
    expect(await res.json()).toMatchObject({ meetings: 1, sent: 1, skipped: 2, failed: [] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ chat_id: 11, text: 'Algebra *1* meeting has started' });
    expect(body.parse_mode).toBeUndefined();
  });
});
