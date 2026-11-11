/**
 * @jest-environment node
 */
// QA ARU-151: gaps in meeting-notes.test.ts: near-miss Authorization headers and the secret in the query string,
// odd bodies (array, padded or SQL-looking id, extra fields), extra body fields never reach the lookup or the text,
// a name containing "{course}" stays as typed, each recipient gets their own language with the real helper (ru, en,
// device language, no profile), the helper is called exactly once (never retried), and nothing about the note's text
// can reach the message.
import { handleMeetingNotesRequest, type MeetingNotesDeps, meetingNotesMessages, meetingNotesText } from './meeting-notes';
import { sendTelegramMessages, type SendResult, type ServiceClient, type TelegramMessage } from './telegram';
import { TELEGRAM_TEXTS } from './telegram-texts';

const SECRET = 'notes-secret-123';
const ID = '0b6f1c1e-2a3b-4c5d-8e9f-001122334455';
const URL_ = 'https://x.supabase.co/functions/v1/meeting-notes-notifications';

function deps(rows = [{ user_id: 'U1', author_name: 'Aigerim', course_title: 'Algebra' }]) {
  const d: MeetingNotesDeps = {
    recipients: jest.fn(async () => rows),
    send: jest.fn(async (m: TelegramMessage[]): Promise<SendResult> => ({ sent: m.length, skipped: 0, failed: [], removed: 0 })),
    log: jest.fn(),
  };
  return d;
}
const req = (body: string | undefined, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }, url = URL_, method = 'POST') =>
  new Request(url, { method, headers: { 'content-type': 'application/json', ...headers }, body });

it.each([
  ['lower-case "bearer"', { authorization: `bearer ${SECRET}` }],
  ['two spaces', { authorization: `Bearer  ${SECRET}` }],
  ['an extra character', { authorization: `Bearer ${SECRET}x` }],
  ['a prefix of the secret', { authorization: `Bearer ${SECRET.slice(0, -1)}` }],
  ['the secret alone', { authorization: SECRET }],
  ['another header', { 'x-cron-secret': SECRET }],
])('AC 10: %s → 401, nothing looked up or sent', async (_k, headers) => {
  const d = deps();
  const res = await handleMeetingNotesRequest(req(JSON.stringify({ id: ID }), headers), SECRET, d);
  expect(res.status).toBe(401);
  expect(d.recipients).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('AC 10: the secret in the query string → 401', async () => {
  const d = deps();
  const res = await handleMeetingNotesRequest(req(JSON.stringify({ id: ID }), {}, `${URL_}?secret=${SECRET}`), SECRET, d);
  expect(res.status).toBe(401);
  expect(d.recipients).not.toHaveBeenCalled();
});

it('AC 10: a GET with the right secret is refused and looks nothing up', async () => {
  const d = deps();
  const res = await handleMeetingNotesRequest(req(undefined, undefined, URL_, 'GET'), SECRET, d);
  expect(res.status).toBe(405);
  expect(d.recipients).not.toHaveBeenCalled();
});

it.each([
  ['an array', JSON.stringify([{ id: ID }])],
  ['a padded id', JSON.stringify({ id: ` ${ID} ` })],
  ['an SQL-looking id', JSON.stringify({ id: `${ID}' or '1'='1` })],
  ['an id in another field', JSON.stringify({ note: ID })],
  ['no body', undefined],
])('a body of %s → 400, nothing looked up', async (_k, body) => {
  const d = deps();
  const res = await handleMeetingNotesRequest(req(body), SECRET, d);
  expect(res.status).toBe(400);
  expect(d.recipients).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

it('extra body fields are ignored: the lookup gets only the id and the text never uses them', async () => {
  const d = deps();
  const res = await handleMeetingNotesRequest(
    req(JSON.stringify({ id: ID, user_id: 'X', body: 'Secret note text', author_name: 'Fake' })),
    SECRET,
    d,
  );
  expect(res.status).toBe(200);
  expect(d.recipients).toHaveBeenCalledWith(ID);
  const sent = (d.send as jest.Mock).mock.calls[0][0] as TelegramMessage[];
  expect(sent).toHaveLength(1);
  expect(sent[0].userId).toBe('U1');
  expect(sent[0].text).toBe('New notes from Aigerim on a Algebra meeting');
  for (const t of [sent[0].text, ...Object.values(sent[0].texts ?? {})]) {
    expect(t).not.toContain('Secret note text');
    expect(t).not.toContain('Fake');
  }
});

it('AC 1 / edge: a name containing "{course}" and titles with *, _, <, emoji stay as typed', () => {
  expect(meetingNotesText('Sam {course}', 'Alg_<b> 😀')).toBe('New notes from Sam {course} on a Alg_<b> 😀 meeting');
  const [m] = meetingNotesMessages([{ user_id: 'U', author_name: 'Айгерім {name}', course_title: '*Курс*' }]);
  expect(m.texts?.ru).toBe('Новые заметки от Айгерім {name} к встрече курса *Курс*');
  expect(m.kind).toBe('meeting_notes');
});

it('the catalog entry has both languages, the same placeholders and a note', () => {
  const e = TELEGRAM_TEXTS.meetingNotesPublished;
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
  expect(ph(e.en)).toEqual(['{course}', '{name}']);
  expect(ph(e.ru)).toEqual(ph(e.en));
  expect(e.note.length).toBeGreaterThan(10);
});

it('AC 9: the helper throwing is reported, never retried: send is called exactly once', async () => {
  const d = deps([
    { user_id: 'U1', author_name: 'A', course_title: 'C' },
    { user_id: 'U2', author_name: 'A', course_title: 'C' },
  ]);
  (d.send as jest.Mock).mockRejectedValueOnce(new Error('telegram down'));
  const res = await handleMeetingNotesRequest(req(JSON.stringify({ id: ID })), SECRET, d);
  expect(res.status).toBe(200);
  expect(d.send).toHaveBeenCalledTimes(1);
  const report = await res.json();
  expect(report.recipients).toBe(2);
  expect(report.failed.map((f: { userId: string }) => f.userId)).toEqual(['U1', 'U2']);
});

describe('with the real helper: each recipient in their language', () => {
  // telegram_links rows and profiles rows the helper reads with the service role.
  function client(languages: Record<string, { language?: string | null; device_language?: string | null }>) {
    const links = ['RU', 'EN', 'DEV', 'NOPROF'].map((u, i) => ({ user_id: u, chat_id: 100 + i, notify_meeting_notes: true }));
    const profiles = Object.entries(languages).map(([id, l]) => ({ id, ...l }));
    return {
      from: (table: string) => ({
        select: () => ({
          in: async () => ({ data: table === 'telegram_links' ? links : profiles, error: null }),
        }),
        delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
      }),
    } as unknown as ServiceClient;
  }

  it('ru → Russian, en → English, device language ru → Russian, no profile → English; one Telegram call each', async () => {
    const sent: { chat_id: number; text: string }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    const c = client({ RU: { language: 'ru' }, EN: { language: 'en', device_language: 'ru' }, DEV: { device_language: 'ru' } });
    const rows = ['RU', 'EN', 'DEV', 'NOPROF'].map((u) => ({ user_id: u, author_name: 'Sam', course_title: 'Algebra' }));
    const d: MeetingNotesDeps = { recipients: async () => rows, send: (m) => sendTelegramMessages(c, 'TOKEN', fetchFn, m) };
    const res = await handleMeetingNotesRequest(req(JSON.stringify({ id: ID })), SECRET, d);
    expect(res.status).toBe(200);
    const byChat = Object.fromEntries(sent.map((s) => [s.chat_id, s.text]));
    expect(byChat[100]).toBe('Новые заметки от Sam к встрече курса Algebra');
    expect(byChat[101]).toBe('New notes from Sam on a Algebra meeting');
    expect(byChat[102]).toBe('Новые заметки от Sam к встрече курса Algebra');
    expect(byChat[103]).toBe('New notes from Sam on a Algebra meeting');
    expect(sent).toHaveLength(4);
  });
});
