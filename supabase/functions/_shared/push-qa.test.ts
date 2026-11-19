/**
 * @jest-environment node
 */
// ARU-166 QA: the push sender end to end with every notification kind's real message builder, Expo's push service
// and the service-role client mocked. Covers AC 9 (recipients without Telegram, every phone, switches, no Telegram),
// AC 10 (no person's name in any payload, title "Sham"), AC 11 (language), AC 13 (tickets, retries within one call,
// batches) and the response shape of a notification function using the real sender.
import { chatMessageMessages, generalMessageMessages } from './chat-message';
import { homeworkReviewedMessages } from './homework-reviewed';
import { homeworkSubmittedMessages } from './homework-submitted';
import { handleMeetingNotesRequest, meetingNotesMessages } from './meeting-notes';
import { newAccountMessages } from './new-account';
import { newHomeworkMessages } from './new-homework';
import { newMaterialMessages } from './new-material';
import { EXPO_PUSH_URL, type PushServiceClient, sendPushMessages } from './push';
import { type NotificationKind, SWITCH_COLUMN, type TelegramMessage } from './telegram';

type Device = { user_id: string; token: string };
type Settings = { user_id: string } & Record<string, unknown>;
type Profile = { id: string; language?: string | null; device_language?: string | null };

function fakeClient(db: { devices?: Device[]; settings?: Settings[]; profiles?: Profile[] }) {
  const tables: string[] = [];
  const deleted: string[][] = [];
  const client: PushServiceClient = {
    from: (table) => {
      tables.push(table);
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => {
            const rows =
              table === 'push_devices'
                ? (db.devices ?? []).filter((d) => ids.includes(d.user_id))
                : table === 'notification_settings'
                  ? (db.settings ?? []).filter((s) => ids.includes(s.user_id))
                  : (db.profiles ?? []).filter((p) => ids.includes(p.id));
            return Promise.resolve({ data: rows, error: null });
          },
        }),
        delete: () => ({
          in: (_col: string, tokens: string[]) => {
            deleted.push(tokens);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    },
  };
  return { client, tables, deleted };
}

type Sent = Record<string, unknown> & { to: string; title: string; body: string };
type Answer = { status: number; body: unknown } | Error;
const okTickets = (n: number) => ({ data: Array.from({ length: n }, () => ({ status: 'ok', id: 'x' })) });
function fakeFetch(answers: ((batch: Sent[]) => Answer)[] = []) {
  const calls: { url: string; batch: Sent[] }[] = [];
  const fn = jest.fn(async (url: string, init: { body: string }) => {
    const batch = JSON.parse(init.body) as Sent[];
    calls.push({ url, batch });
    const answer = answers.shift()?.(batch) ?? { status: 200, body: okTickets(batch.length) };
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      statusText: '',
      headers: { get: () => null },
      json: async () => answer.body,
    };
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}
const noWait = { sleep: async () => {} };

// Names that must never reach Expo, Apple or Google (AC 10).
const NAMES = ['Aigerim', 'Nurlanovna', 'Sam', 'Student', 'Dana', 'Serikova', 'Айгерім'];
const U = 'U1'; // never linked Telegram: the sender doesn't care (AC 9)

const KINDS: [NotificationKind, TelegramMessage[]][] = [
  // ARU-170: meeting started and photo deletion are local reminders on the phone now, never pushed.
  ['new_homework', newHomeworkMessages([{ user_id: U, course_title: 'Algebra' }])],
  ['homework_reviewed', homeworkReviewedMessages([{ user_id: U, course_title: 'Algebra' }])],
  [
    'homework_submitted',
    homeworkSubmittedMessages([
      { user_id: U, sender_name: 'Sam Student', course_title: 'Algebra', assignment_title: 'Fractions' } as never,
    ]),
  ],
  ['chat_message', chatMessageMessages({ course_title: 'Algebra', recipient_ids: [U] })],
  ['general_chat', generalMessageMessages({ recipient_ids: [U] })],
  ['new_material', newMaterialMessages('blog', [{ user_id: U, author_name: 'Aigerim Nurlanovna', item_title: 'Tips' }])],
  ['new_material', newMaterialMessages('file', [{ user_id: U, author_name: 'Айгерім', item_title: 'Guide.pdf' }])],
  ['meeting_notes', meetingNotesMessages([{ user_id: U, author_name: 'Aigerim Nurlanovna', course_title: 'Algebra' }])],
  ['new_account', newAccountMessages([{ user_id: U, account_name: 'Dana Serikova' }])],
];

describe('AC 9 / AC 10: every kind, through the real sender', () => {
  it.each(KINDS.map(([k, m], i) => [`${i} ${k}`, k, m] as const))(
    '%s: a recipient with no Telegram link and no settings row gets it on both phones; no name, title Sham, nothing else',
    async (_n, kind, messages) => {
      expect(messages).toHaveLength(1);
      expect(messages[0].kind).toBe(kind);
      const { client, tables } = fakeClient({
        devices: [
          { user_id: U, token: 'ExponentPushToken[a]' },
          { user_id: U, token: 'ExponentPushToken[b]' },
        ],
        profiles: [{ id: U, language: 'ru' }],
      });
      const f = fakeFetch();
      const res = await sendPushMessages(client, f.fetch, messages, noWait);
      expect(res).toEqual({ sent: 1, skipped: 0, failed: [], removed: 0 });
      expect(tables).not.toContain('telegram_links');
      expect(f.calls.map((c) => c.url)).toEqual([EXPO_PUSH_URL]);
      const batch = f.calls[0].batch;
      expect(batch.map((b) => b.to).sort()).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
      for (const p of batch) {
        // Only what a notification needs: no data payload carrying ids or names.
        expect(Object.keys(p).sort()).toEqual(['body', 'channelId', 'priority', 'sound', 'title', 'to']);
        expect(p.title).toBe('Sham');
        for (const name of NAMES) expect(p.body).not.toContain(name);
        expect(p.body.length).toBeGreaterThan(5);
      }
      // Every language of the message is name-free too.
      for (const text of [messages[0].text, ...Object.values(messages[0].texts ?? {})]) {
        for (const name of NAMES) expect(text).not.toContain(name);
      }
    },
  );

  it.each(Object.keys(SWITCH_COLUMN) as NotificationKind[])('%s off: skipped; the other nine on still send', async (kind) => {
    const messages = (Object.keys(SWITCH_COLUMN) as NotificationKind[]).map((k) => ({ userId: U, kind: k, text: `t ${k}` }));
    const { client } = fakeClient({
      devices: [{ user_id: U, token: 'ExponentPushToken[a]' }],
      settings: [{ user_id: U, [SWITCH_COLUMN[kind]]: false }],
    });
    const f = fakeFetch();
    const res = await sendPushMessages(client, f.fetch, messages, noWait);
    expect(res.sent).toBe(9);
    expect(res.skipped).toBe(1);
    expect(f.calls.flatMap((c) => c.batch.map((b) => b.body))).not.toContain(`t ${kind}`);
  });

  it('AC 11: a recipient with only a phone language saved gets Russian; no language at all gets English', async () => {
    const messages = newAccountMessages([
      { user_id: 'RU', account_name: 'Dana' },
      { user_id: 'NONE', account_name: 'Dana' },
    ]);
    const { client } = fakeClient({
      devices: [
        { user_id: 'RU', token: 'ExponentPushToken[ru]' },
        { user_id: 'NONE', token: 'ExponentPushToken[none]' },
      ],
      profiles: [{ id: 'RU', language: null, device_language: 'ru' }, { id: 'NONE' }],
    });
    const f = fakeFetch();
    await sendPushMessages(client, f.fetch, messages, noWait);
    const byToken = Object.fromEntries(f.calls[0].batch.map((b) => [b.to, b.body]));
    expect(byToken['ExponentPushToken[ru]']).toBe(
      'Новый аккаунт ждёт вашего подтверждения. Откройте Sham → Управление ролями, чтобы принять или отклонить.',
    );
    expect(byToken['ExponentPushToken[none]']).toBe(
      'New account waiting for your approval. Open Sham → Manage roles to accept or decline.',
    );
  });
});

describe('AC 13: retries within one call, never later', () => {
  const one = (): [PushServiceClient, TelegramMessage[]] => [
    fakeClient({ devices: [{ user_id: U, token: 'ExponentPushToken[a]' }] }).client,
    [{ userId: U, kind: 'chat_message', text: 'x' }],
  ];

  it('a network error, then a 503, then success: sent after 3 tries', async () => {
    const [client, messages] = one();
    const f = fakeFetch([() => new Error('offline'), () => ({ status: 503, body: {} })]);
    const res = await sendPushMessages(client, f.fetch, messages, noWait);
    expect(f.calls).toHaveLength(3);
    expect(res.sent).toBe(1);
    expect(res.failed).toEqual([]);
  });

  it('three 429s: failed after 3 tries; the next call sends only its own messages, once', async () => {
    const [client, messages] = one();
    const tooMany = () => ({ status: 429, body: { errors: [{ message: 'slow down' }] } });
    const f = fakeFetch([tooMany, tooMany, tooMany]);
    const res = await sendPushMessages(client, f.fetch, messages, noWait);
    expect(f.calls).toHaveLength(3);
    expect(res.sent).toBe(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].error).toContain('429');
    const next = await sendPushMessages(client, f.fetch, [{ userId: U, kind: 'general_chat', text: 'y' }], noWait);
    expect(f.calls).toHaveLength(4);
    expect(f.calls[3].batch.map((b) => b.body)).toEqual(['y']);
    expect(next.sent).toBe(1);
  });

  it('batches: 150 recipients → 100 + 50; the second batch failing leaves the first sent', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `R${i}`);
    const { client } = fakeClient({ devices: ids.map((id) => ({ user_id: id, token: `ExponentPushToken[${id}]` })) });
    const bad = () => ({ status: 400, body: { errors: [{ message: 'bad request' }] } });
    const f = fakeFetch([(b) => ({ status: 200, body: okTickets(b.length) }), bad]);
    const res = await sendPushMessages(
      client,
      f.fetch,
      ids.map((id) => ({ userId: id, kind: 'chat_message' as const, text: 'x' })),
      noWait,
    );
    expect(f.calls.map((c) => c.batch.length)).toEqual([100, 50]);
    expect(res.sent).toBe(100);
    expect(res.failed).toHaveLength(50);
  });

  it('DeviceNotRegistered on both phones of a user: both registrations deleted, the message failed', async () => {
    const { client, deleted } = fakeClient({
      devices: [
        { user_id: U, token: 'ExponentPushToken[a]' },
        { user_id: U, token: 'ExponentPushToken[b]' },
      ],
    });
    const gone = { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } };
    const f = fakeFetch([() => ({ status: 200, body: { data: [gone, gone] } })]);
    const res = await sendPushMessages(client, f.fetch, [{ userId: U, kind: 'chat_message', text: 'x' }], noWait);
    expect(deleted).toEqual([['ExponentPushToken[a]', 'ExponentPushToken[b]']]);
    expect(res.removed).toBe(2);
    expect(res.sent).toBe(0);
    expect(res.failed).toHaveLength(1);
  });
});

it('AC 13: a notification function with the real sender still reports recipients, sent, skipped and failed', async () => {
  const SECRET = 'qa-secret';
  const { client } = fakeClient({ devices: [{ user_id: 'A', token: 'ExponentPushToken[a]' }] });
  const f = fakeFetch();
  const res = await handleMeetingNotesRequest(
    new Request('https://x.test/fn', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }),
    }),
    SECRET,
    {
      recipients: async () => [
        { user_id: 'A', author_name: 'Aigerim', course_title: 'Algebra' },
        { user_id: 'NOPHONE', author_name: 'Aigerim', course_title: 'Algebra' },
      ],
      send: (m) => sendPushMessages(client, f.fetch, m, noWait),
    },
  );
  expect(res.status).toBe(200);
  const report = await res.json();
  expect(report).toMatchObject({ recipients: 2, sent: 1, skipped: 1, failed: [] });
  expect(f.calls[0].batch[0].body).toBe('New notes on a Algebra meeting');
});

it('the bot\'s /start and /stop replies still go through Telegram (not removed before ARU-171)', () => {
  const fs = jest.requireActual<{ readFileSync: (f: string, e: 'utf8') => string; existsSync: (f: string) => boolean }>('fs');
  const webhook = fs.readFileSync('supabase/functions/telegram-webhook/index.ts', 'utf8');
  expect(webhook).toContain('sendTelegramText');
  expect(webhook).toMatch(/Deno\.env\.get\('TELEGRAM_BOT_TOKEN'\)/);
  expect(fs.existsSync('src/app/telegram.tsx')).toBe(true);
});
