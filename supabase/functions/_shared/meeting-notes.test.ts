/**
 * @jest-environment node
 */
// ARU-151: the meeting-notes-notifications function's logic, with the recipient lookup and the sending helper mocked
// (AC 1, 9, 10), and end to end with the real ARU-48 helper and a mocked Telegram (AC 1 languages, AC 7 switch).
import {
  handleMeetingNotesRequest,
  type MeetingNotesDeps,
  meetingNotesMessages,
  type MeetingNotesRecipient,
  meetingNotesText,
} from './meeting-notes';
import { sendTelegramMessages, type SendResult, type ServiceClient, type TelegramMessage } from './telegram';
import { TELEGRAM_TEXTS } from './telegram-texts';

const SECRET = 'notes-secret-123';
const ID = '3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const post = (
  body: unknown = { id: ID },
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
  method = 'POST',
) =>
  new Request('https://x.supabase.co/functions/v1/meeting-notes-notifications', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const ok: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

function deps(rows: MeetingNotesRecipient[], result: Partial<SendResult> = {}) {
  const sent: TelegramMessage[][] = [];
  const logs: string[] = [];
  const d: MeetingNotesDeps = {
    recipients: jest.fn(async () => rows),
    send: jest.fn(async (messages: TelegramMessage[]) => {
      sent.push(messages);
      return { ...ok, sent: messages.length, ...result };
    }),
    log: (line) => logs.push(line),
  };
  return { d, sent, logs };
}

const rows: MeetingNotesRecipient[] = [
  { user_id: 'T', author_name: 'Aigerim', course_title: 'Algebra' },
  { user_id: 'M', author_name: 'Aigerim', course_title: 'Algebra' },
  { user_id: 'M2', author_name: 'Aigerim', course_title: 'Algebra' },
];
const EN = 'New notes from Aigerim on a Algebra meeting';
const RU = 'Новые заметки от Aigerim к встрече курса Algebra';

describe('AC 10: the secret', () => {
  it.each([
    ['no Authorization header', {}],
    ['a wrong secret', { authorization: 'Bearer nope' }],
    ['the secret without Bearer', { authorization: SECRET }],
  ])('%s: 401, nothing looked up or sent', async (_name, headers) => {
    const { d } = deps(rows);
    const res = await handleMeetingNotesRequest(post(undefined, headers), SECRET, d);
    expect(res.status).toBe(401);
    expect(d.recipients).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('an empty configured secret refuses everyone', async () => {
    const { d } = deps(rows);
    expect((await handleMeetingNotesRequest(post(undefined, { authorization: 'Bearer ' }), '', d)).status).toBe(401);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('only POST', async () => {
    const { d } = deps(rows);
    expect((await handleMeetingNotesRequest(post(undefined, undefined, 'GET'), SECRET, d)).status).toBe(405);
  });
});

describe('AC 1: the message', () => {
  it('the catalog has the story\'s English and Russian texts, with a note', () => {
    expect(TELEGRAM_TEXTS.meetingNotesPublished.en).toBe('New notes from {name} on a {course} meeting');
    expect(TELEGRAM_TEXTS.meetingNotesPublished.ru).toBe('Новые заметки от {name} к встрече курса {course}');
    expect(TELEGRAM_TEXTS.meetingNotesPublished.note).toMatch(/^Meeting notes · /);
  });

  it('names and titles as typed (plain text)', () => {
    expect(meetingNotesText('Aigerim', 'Algebra')).toBe(EN);
    expect(meetingNotesText('Дана *_', '<b>T</b> & 😀')).toBe('New notes from Дана *_ on a <b>T</b> & 😀 meeting');
  });

  it('one meeting_notes message per recipient, in one send call', async () => {
    const { d, sent, logs } = deps(rows);
    const res = await handleMeetingNotesRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.recipients).toHaveBeenCalledWith(ID);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      [
        { userId: 'T', kind: 'meeting_notes', text: EN },
        { userId: 'M', kind: 'meeting_notes', text: EN },
        { userId: 'M2', kind: 'meeting_notes', text: EN },
      ],
    ]);
    expect(sent[0][0].texts).toEqual({ en: EN, ru: RU });
    expect(await res.json()).toEqual({ recipients: 3, sent: 3, skipped: 0, failed: [], removed: 0 });
    expect(logs.join('\n')).toContain(`meeting-notes: ${ID}: 3 recipient(s), sent 3`);
  });

  it('one message per row', () => {
    expect(meetingNotesMessages(rows).map((m) => m.userId)).toEqual(['T', 'M', 'M2']);
  });
});

describe('nothing to send / bad requests', () => {
  it('no recipients (nobody linked, private, deleted or unknown note): 200, nothing sent', async () => {
    const { d } = deps([]);
    const res = await handleMeetingNotesRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ recipients: 0, sent: 0, skipped: 0, failed: [], removed: 0 });
  });

  it.each([[{}], [{ id: 'nope' }], [{ id: 42 }], ['not json'], [null]])(
    'bad body %p: 400, nothing looked up',
    async (body) => {
      const { d } = deps(rows);
      expect((await handleMeetingNotesRequest(post(body), SECRET, d)).status).toBe(400);
      expect(d.recipients).not.toHaveBeenCalled();
    },
  );
});

describe('AC 9: failures are logged and dropped', () => {
  it('the lookup failing: 500, nothing sent', async () => {
    const { d, logs } = deps(rows);
    (d.recipients as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    expect((await handleMeetingNotesRequest(post(), SECRET, d)).status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('recipient lookup failed: db down');
  });

  it('the helper throwing: 200 with every message reported failed', async () => {
    const { d } = deps(rows);
    (d.send as jest.Mock).mockRejectedValueOnce(new Error('telegram down'));
    const res = await handleMeetingNotesRequest(post(), SECRET, d);
    expect(res.status).toBe(200);
    expect((await res.json()).failed).toEqual([
      { userId: 'T', error: 'telegram down' },
      { userId: 'M', error: 'telegram down' },
      { userId: 'M2', error: 'telegram down' },
    ]);
  });
});

describe('with the real helper: languages (AC 1) and the Meeting notes switch (AC 7)', () => {
  function client(on: boolean): ServiceClient {
    const links = [
      { user_id: 'T', chat_id: 11, notify_meeting_notes: true },
      { user_id: 'M', chat_id: 12, notify_meeting_notes: on },
    ];
    const profiles = [
      { id: 'T', language: 'ru', device_language: null },
      { id: 'M', language: 'en', device_language: null },
    ];
    return {
      from: (table) => ({
        select: () => ({
          in: async () => ({ data: table === 'profiles' ? profiles : links, error: null }),
        }),
        delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
      }),
    };
  }
  const run = async (on: boolean) => {
    const fetchFn = jest.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const { d } = deps(rows.slice(0, 2));
    d.send = (messages) =>
      sendTelegramMessages(client(on), 'TOKEN', fetchFn as unknown as typeof fetch, messages, { sleep: async () => {} });
    const res = await handleMeetingNotesRequest(post(), SECRET, d);
    const texts = (fetchFn.mock.calls as unknown as [string, RequestInit][]).map((c) => {
      const b = JSON.parse(c[1].body as string);
      return [b.chat_id, b.text];
    });
    return { body: await res.json(), texts };
  };

  it('on: each in their own language, as plain text', async () => {
    const { body, texts } = await run(true);
    expect(body).toMatchObject({ sent: 2, skipped: 0 });
    expect(texts).toEqual([
      [11, RU],
      [12, EN],
    ]);
  });

  it('off for M: M skipped, the teacher still gets it', async () => {
    const { body, texts } = await run(false);
    expect(body).toMatchObject({ sent: 1, skipped: 1 });
    expect(texts).toEqual([[11, RU]]);
  });
});
