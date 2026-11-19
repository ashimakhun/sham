/**
 * @jest-environment node
 */
// ARU-166: the shared push sender, with fetch and the service-role client mocked (AC 8, 9, 10, 11, 13).
import { homeworkSubmittedMessages } from './homework-submitted';
import { meetingNotesMessages } from './meeting-notes';
import { newAccountMessages } from './new-account';
import { newMaterialMessages } from './new-material';
import { EXPO_PUSH_URL, type PushServiceClient, sendPushMessages } from './push';
import { localizedMessage, type TelegramMessage } from './telegram';

type Device = { user_id: string; token: string };
type Settings = { user_id: string } & Record<string, unknown>;
type Profile = { id: string; language?: string | null; device_language?: string | null };

function fakeClient(db: { devices?: Device[]; settings?: Settings[]; profiles?: Profile[]; fail?: string }) {
  const deleted: string[][] = [];
  const client: PushServiceClient = {
    from: (table) => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          if (db.fail === table) return Promise.resolve({ data: null, error: { message: `${table} down` } });
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
    }),
  };
  return { client, deleted };
}

type Sent = { to: string; title: string; body: string; sound: string; channelId: string };
const ok = (n: number) => ({ data: Array.from({ length: n }, () => ({ status: 'ok', id: 'x' })) });
function fakeFetch(answers: ((batch: Sent[]) => { status: number; body: unknown } | Error)[] = []) {
  const calls: { url: string; headers: Record<string, string>; batch: Sent[] }[] = [];
  const fn = jest.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const batch = JSON.parse(init.body) as Sent[];
    calls.push({ url, headers: init.headers, batch });
    const answer = answers.shift()?.(batch) ?? { status: 200, body: ok(batch.length) };
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
const msg = (userId: string, kind: TelegramMessage['kind'] = 'chat_message'): TelegramMessage => ({
  userId,
  kind,
  text: `hello ${userId}`,
});

describe('AC 9: who gets it', () => {
  it('no settings row = all on; every registered phone gets it; title Sham, sound on, the General channel', async () => {
    const { client } = fakeClient({ devices: [{ user_id: 'A', token: 'tA1' }, { user_id: 'A', token: 'tA2' }, { user_id: 'B', token: 'tB' }] });
    const { fetch, calls } = fakeFetch();
    const result = await sendPushMessages(client, fetch, [msg('A'), msg('B')], noWait);
    expect(result).toEqual({ sent: 2, skipped: 0, failed: [], removed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(EXPO_PUSH_URL);
    expect(calls[0].batch.map((b) => b.to)).toEqual(['tA1', 'tA2', 'tB']);
    expect(calls[0].batch[0]).toMatchObject({ title: 'Sham', body: 'hello A', sound: 'default', channelId: 'default' });
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it('a switch off or no phone: skipped, nothing sent; other switches off don\'t matter', async () => {
    const { client } = fakeClient({
      devices: [{ user_id: 'A', token: 'tA' }, { user_id: 'C', token: 'tC' }],
      settings: [
        { user_id: 'A', notify_chat_message: false },
        { user_id: 'C', notify_chat_message: true, notify_general_chat: false },
      ],
    });
    const { fetch, calls } = fakeFetch();
    const result = await sendPushMessages(client, fetch, [msg('A'), msg('B'), msg('C')], noWait);
    expect(result).toEqual({ sent: 1, skipped: 2, failed: [], removed: 0 });
    expect(calls[0].batch.map((b) => b.to)).toEqual(['tC']);
  });

  it('nothing to send: no request', async () => {
    const { client } = fakeClient({});
    const { fetch, calls } = fakeFetch();
    expect(await sendPushMessages(client, fetch, [msg('A')], noWait)).toEqual({ sent: 0, skipped: 1, failed: [], removed: 0 });
    expect(await sendPushMessages(client, fetch, [], noWait)).toEqual({ sent: 0, skipped: 0, failed: [], removed: 0 });
    expect(calls).toHaveLength(0);
  });

  it('a database error fails every message, nothing sent', async () => {
    const { client } = fakeClient({ devices: [{ user_id: 'A', token: 'tA' }], fail: 'push_devices' });
    const { fetch, calls } = fakeFetch();
    const result = await sendPushMessages(client, fetch, [msg('A')], noWait);
    expect(result.failed).toEqual([{ userId: 'A', error: 'push_devices down' }]);
    expect(calls).toHaveLength(0);
  });

  it('EXPO_ACCESS_TOKEN, when set, is sent as a bearer token', async () => {
    const { client } = fakeClient({ devices: [{ user_id: 'A', token: 'tA' }] });
    const { fetch, calls } = fakeFetch();
    await sendPushMessages(client, fetch, [msg('A')], { ...noWait, accessToken: 'secret' });
    expect(calls[0].headers.authorization).toBe('Bearer secret');
  });
});

describe('AC 11: each recipient\'s language', () => {
  it('Profile language, else phone language, else English', async () => {
    const { client } = fakeClient({
      devices: ['RU', 'DEV', 'EN', 'NONE'].map((u) => ({ user_id: u, token: `t${u}` })),
      profiles: [
        { id: 'RU', language: 'ru' },
        { id: 'DEV', language: null, device_language: 'ru' },
        { id: 'EN', language: 'en', device_language: 'ru' },
      ],
    });
    const { fetch, calls } = fakeFetch();
    const texts = { en: 'New message in the Algebra chat', ru: 'Новое сообщение в чате курса Algebra' };
    await sendPushMessages(client, fetch, ['RU', 'DEV', 'EN', 'NONE'].map((u) => localizedMessage(u, 'chat_message', texts)), noWait);
    expect(calls[0].batch.map((b) => b.body)).toEqual([texts.ru, texts.ru, texts.en, texts.en]);
  });
});

describe('AC 13: tickets, retries, batches', () => {
  it('DeviceNotRegistered deletes that registration; the other phone still counts as sent', async () => {
    const { client, deleted } = fakeClient({
      devices: [{ user_id: 'A', token: 'old' }, { user_id: 'A', token: 'new' }, { user_id: 'B', token: 'gone' }],
    });
    const notRegistered = { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } };
    const { fetch } = fakeFetch([() => ({ status: 200, body: { data: [notRegistered, { status: 'ok' }, notRegistered] } })]);
    const result = await sendPushMessages(client, fetch, [msg('A'), msg('B')], noWait);
    expect(deleted).toEqual([['old', 'gone']]);
    expect(result.sent).toBe(1);
    expect(result.removed).toBe(2);
    expect(result.failed).toEqual([{ userId: 'B', error: 'DeviceNotRegistered: not registered' }]);
  });

  it('another ticket error fails the message and deletes nothing', async () => {
    const { client, deleted } = fakeClient({ devices: [{ user_id: 'A', token: 'tA' }] });
    const { fetch } = fakeFetch([
      () => ({ status: 200, body: { data: [{ status: 'error', message: 'too big', details: { error: 'MessageTooBig' } }] } }),
    ]);
    const result = await sendPushMessages(client, fetch, [msg('A')], noWait);
    expect(result).toEqual({ sent: 0, skipped: 0, failed: [{ userId: 'A', error: 'MessageTooBig: too big' }], removed: 0 });
    expect(deleted).toEqual([]);
  });

  it.each([
    ['a network error', () => new Error('offline')],
    ['429', () => ({ status: 429, body: {} })],
    ['500', () => ({ status: 500, body: {} })],
    ['503', () => ({ status: 503, body: {} })],
  ])('%s is retried in the same call, then sent', async (_name, first) => {
    const { client } = fakeClient({ devices: [{ user_id: 'A', token: 'tA' }] });
    const { fetch, calls } = fakeFetch([first]);
    expect((await sendPushMessages(client, fetch, [msg('A')], noWait)).sent).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it('at most 3 tries, then failed (never retried by a later call)', async () => {
    const { client } = fakeClient({ devices: [{ user_id: 'A', token: 'tA' }] });
    const down = () => ({ status: 502, body: { errors: [{ message: 'bad gateway' }] } });
    const { fetch, calls } = fakeFetch([down, down, down, down]);
    const result = await sendPushMessages(client, fetch, [msg('A')], noWait);
    expect(calls).toHaveLength(3);
    expect(result.failed).toEqual([{ userId: 'A', error: '502 bad gateway' }]);
  });

  it('a 400 is not retried', async () => {
    const { client } = fakeClient({ devices: [{ user_id: 'A', token: 'tA' }] });
    const { fetch, calls } = fakeFetch([() => ({ status: 400, body: { errors: [{ message: 'bad request' }] } })]);
    const result = await sendPushMessages(client, fetch, [msg('A')], noWait);
    expect(calls).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });

  it('no time left in the call: gives up instead of waiting', async () => {
    const { client } = fakeClient({ devices: [{ user_id: 'A', token: 'tA' }] });
    const { fetch, calls } = fakeFetch([() => ({ status: 500, body: {} })]);
    const result = await sendPushMessages(client, fetch, [msg('A')], { ...noWait, budgetMs: 100 });
    expect(calls).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });

  it('over 100 notifications are split into requests of at most 100', async () => {
    const devices = Array.from({ length: 250 }, (_, i) => ({ user_id: `U${i}`, token: `t${i}` }));
    const { client } = fakeClient({ devices });
    const { fetch, calls } = fakeFetch();
    const result = await sendPushMessages(client, fetch, devices.map((d) => msg(d.user_id)), noWait);
    expect(calls.map((c) => c.batch.length)).toEqual([100, 100, 50]);
    expect(result.sent).toBe(250);
  });
});

describe('AC 10: no push text names a person', () => {
  const NAME = 'Aigerim Name';
  it.each([
    ['homework submitted', homeworkSubmittedMessages([{ user_id: 'U', sender_name: NAME, course_title: 'Algebra', assignment_title: 'Ch 3' }])],
    ['new account', newAccountMessages([{ user_id: 'U', account_name: NAME }])],
    ['new blog post', newMaterialMessages('blog', [{ user_id: 'U', author_name: NAME, item_title: 'Tips' }])],
    ['new file', newMaterialMessages('file', [{ user_id: 'U', author_name: NAME, item_title: 'Guide.pdf' }])],
    ['meeting notes', meetingNotesMessages([{ user_id: 'U', author_name: NAME, course_title: 'Algebra' }])],
  ])('%s', (_kind, messages) => {
    const [m] = messages;
    expect(m.text).not.toContain(NAME);
    expect(m.texts?.ru).not.toContain(NAME);
  });

  it('the five changed texts, exactly', () => {
    expect(homeworkSubmittedMessages([{ user_id: 'U', sender_name: NAME, course_title: 'Algebra', assignment_title: 'Ch 3' }])[0].texts).toEqual({
      en: 'New homework to check in Algebra: Ch 3',
      ru: 'Новое домашнее задание на проверку по курсу Algebra: Ch 3',
    });
    expect(newAccountMessages([{ user_id: 'U', account_name: NAME }])[0].texts).toEqual({
      en: 'New account waiting for your approval. Open Sham → Manage roles to accept or decline.',
      ru: 'Новый аккаунт ждёт вашего подтверждения. Откройте Sham → Управление ролями, чтобы принять или отклонить.',
    });
    expect(newMaterialMessages('blog', [{ user_id: 'U', author_name: NAME, item_title: 'Tips' }])[0].texts).toEqual({
      en: 'New blog post: Tips',
      ru: 'Новая запись в блоге: Tips',
    });
    expect(newMaterialMessages('file', [{ user_id: 'U', author_name: NAME, item_title: 'Guide.pdf' }])[0].texts).toEqual({
      en: 'New file in the knowledge base: Guide.pdf',
      ru: 'Новый файл в базе знаний: Guide.pdf',
    });
    expect(meetingNotesMessages([{ user_id: 'U', author_name: NAME, course_title: 'Algebra' }])[0].texts).toEqual({
      en: 'New notes on a Algebra meeting',
      ru: 'Новые заметки к встрече курса Algebra',
    });
  });
});

describe('AC 9: the notification functions send push, not Telegram', () => {
  const fs = jest.requireActual<{ readFileSync: (f: string, e: 'utf8') => string }>('fs');
  it.each([
    'chat-message-notifications',
    'homework-reviewed-notifications',
    'homework-submitted-notifications',
    'meeting-notes-notifications',
    'meeting-start-notifications',
    'new-account-notifications',
    'new-homework-notifications',
    'new-material-notifications',
    'photo-deletion',
  ])('%s', (name) => {
    const source = fs.readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
    expect(source).toContain('sendPushMessages');
    expect(source).not.toContain('sendTelegramMessages');
    expect(source).not.toMatch(/Deno\.env\.get\('TELEGRAM_BOT_TOKEN'\)/);
  });
});
