/**
 * @jest-environment node
 */
// ARU-110 (Russian version, part 4): Telegram notifications in each recipient's language. The catalog check (AC 9),
// every kind in English (unchanged) and Russian (AC 3), the language order (AC 1), mixed recipients of one event
// (AC 4), switches unchanged (AC 7) and a failed language read falling back to English.
import { chatMessageMessages, GENERAL_CHAT_TEXT, generalMessageMessages } from './chat-message';
import { homeworkReviewedMessages } from './homework-reviewed';
import { homeworkSubmittedMessages } from './homework-submitted';
import { meetingStartMessages } from './meeting-start';
import { newAccountMessages } from './new-account';
import { newHomeworkMessages } from './new-homework';
import { newMaterialMessages } from './new-material';
import { localizedMessage, sendTelegramMessages, type ServiceClient, type TelegramMessage } from './telegram';
import { recipientLanguage, TELEGRAM_TEXTS, telegramText } from './telegram-texts';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('AC 9: the catalog', () => {
  it.each(Object.entries(TELEGRAM_TEXTS))('%s has English, Russian, a note and the same placeholders', (_id, entry) => {
    expect(entry.en.trim()).not.toBe('');
    expect(entry.ru).toMatch(/[а-яё]/i);
    expect(entry.note).toMatch(/ · /);
    expect(placeholders(entry.ru)).toBe(placeholders(entry.en));
  });

  it('a value is shown as typed, even with braces or formatting characters', () => {
    expect(telegramText('ru', 'meetingStarted', { course: 'Math {course} *_<b>' })).toBe('Встреча курса Math {course} *_<b> началась');
  });
});

describe('AC 3: every kind, English as today and Russian', () => {
  const ru = (m: TelegramMessage[]) => m.map((x) => x.texts?.ru);
  it.each([
    [
      'meeting started',
      meetingStartMessages([{ meeting_id: 'm', course_title: 'Алгебра', listener_ids: ['S1'] }]),
      'Алгебра meeting has started',
      'Встреча курса Алгебра началась',
    ],
    [
      'chat message',
      chatMessageMessages({ course_title: 'Algebra', recipient_ids: ['S1'] } as never),
      'New message in the Algebra chat',
      'Новое сообщение в чате курса Algebra',
    ],
    [
      'general chat',
      generalMessageMessages({ recipient_ids: ['S1'] } as never),
      'New message in the general chat',
      'Новое сообщение в общем чате',
    ],
    [
      'homework reviewed',
      homeworkReviewedMessages([{ user_id: 'S1', course_title: 'Algebra' }] as never),
      'Your homework for Algebra was reviewed',
      'Ваше домашнее задание по курсу Algebra проверено',
    ],
    [
      'new homework',
      newHomeworkMessages([{ user_id: 'S1', course_title: 'Algebra' }] as never),
      'New homework assigned to you in Algebra',
      'Вам задано новое домашнее задание по курсу Algebra',
    ],
    [
      'homework submitted',
      homeworkSubmittedMessages([{ user_id: 'M', sender_name: 'Sam', course_title: 'Algebra', assignment_title: 'Fractions' }] as never),
      'New homework to check from Sam in Algebra: Fractions',
      'Новое домашнее задание на проверку от Sam по курсу Algebra: Fractions',
    ],
    [
      'new account',
      newAccountMessages([{ user_id: 'T', account_name: 'Анна' }] as never),
      'New account waiting for your approval: Анна. Open Sham → Manage roles to accept or decline.',
      'Новый аккаунт ждёт вашего подтверждения: Анна. Откройте Sham → Управление ролями, чтобы принять или отклонить.',
    ],
    [
      'new blog post',
      newMaterialMessages('blog', [{ user_id: 'S1', author_name: 'Tess', item_title: 'Tips' }] as never),
      'New blog post from Tess: Tips',
      'Новая запись в блоге от Tess: Tips',
    ],
    [
      'new knowledge base file',
      newMaterialMessages('file', [{ user_id: 'S1', author_name: 'Tess', item_title: 'Guide' }] as never),
      'New file in the knowledge base from Tess: Guide',
      'Новый файл в базе знаний от Tess: Guide',
    ],
  ])('%s', (_kind, messages, english, russian) => {
    expect(messages.map((m) => m.text)).toEqual([english]);
    expect(ru(messages)).toEqual([russian]);
    // The message still compares as { userId, kind, text }.
    expect(Object.keys(messages[0])).toEqual(['userId', 'kind', 'text']);
  });

  it('the general chat constant is unchanged', () => {
    expect(GENERAL_CHAT_TEXT).toBe('New message in the general chat');
  });
});

describe('AC 1: the language order', () => {
  it.each([
    [{ language: 'ru', device_language: 'en' }, 'ru'],
    [{ language: 'en', device_language: 'ru' }, 'en'],
    [{ language: null, device_language: 'ru' }, 'ru'],
    [{ language: null, device_language: 'en' }, 'en'],
    [{ language: null, device_language: null }, 'en'],
    [{ language: 'de', device_language: 'xx' }, 'en'],
    [undefined, 'en'],
  ])('%j → %s', (profile, lang) => {
    expect(recipientLanguage(profile)).toBe(lang);
  });
});

// A service-role client with links and profiles, recording what it read.
function fakeClient(
  links: { user_id: string; chat_id: number; notify_meeting_started?: boolean }[],
  profiles: { id: string; language: string | null; device_language: string | null }[],
  { profilesError = false } = {},
) {
  const tables: string[] = [];
  const client: ServiceClient = {
    from: (table) => ({
      select: () => ({
        in: async () => {
          tables.push(table);
          if (table === 'profiles') {
            return profilesError ? { data: null, error: { message: 'boom' } } : { data: profiles, error: null };
          }
          return { data: links.map((l) => ({ notify_meeting_started: true, ...l })), error: null };
        },
      }),
      delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
    }),
  };
  return { client, tables };
}
const okFetch = () => jest.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
const sentTexts = (fetchFn: typeof fetch) =>
  (fetchFn as unknown as jest.Mock).mock.calls.map((c) => [JSON.parse(c[1].body).chat_id, JSON.parse(c[1].body).text]);

describe('AC 4 / AC 7: one event, each recipient in their own language', () => {
  const messages = meetingStartMessages([{ meeting_id: 'm', course_title: 'Algebra', listener_ids: ['RU', 'EN', 'NONE', 'DEV', 'OFF'] }]);
  const profiles = [
    { id: 'RU', language: 'ru', device_language: 'en' },
    { id: 'EN', language: 'en', device_language: 'ru' },
    { id: 'NONE', language: null, device_language: null },
    { id: 'DEV', language: null, device_language: 'ru' },
    { id: 'OFF', language: 'ru', device_language: null },
  ];
  const links = [
    { user_id: 'RU', chat_id: 1 },
    { user_id: 'EN', chat_id: 2 },
    { user_id: 'NONE', chat_id: 3 },
    { user_id: 'DEV', chat_id: 4 },
    { user_id: 'OFF', chat_id: 5, notify_meeting_started: false },
  ];

  it('Russian, English, English and Russian; a kind turned off is still skipped', async () => {
    const { client, tables } = fakeClient(links, profiles);
    const fetchFn = okFetch();
    const res = await sendTelegramMessages(client, 'T', fetchFn, messages, { sleep: async () => {} });
    expect(sentTexts(fetchFn)).toEqual([
      [1, 'Встреча курса Algebra началась'],
      [2, 'Algebra meeting has started'],
      [3, 'Algebra meeting has started'],
      [4, 'Встреча курса Algebra началась'],
    ]);
    expect(res).toMatchObject({ sent: 4, skipped: 1, failed: [] });
    expect(tables).toEqual(['telegram_links', 'profiles']);
  });

  it('a failed language read sends English to everyone', async () => {
    const { client } = fakeClient(links, profiles, { profilesError: true });
    const fetchFn = okFetch();
    const res = await sendTelegramMessages(client, 'T', fetchFn, messages, { sleep: async () => {} });
    expect(sentTexts(fetchFn).map(([, text]) => text)).toEqual(Array(4).fill('Algebra meeting has started'));
    expect(res.sent).toBe(4);
  });

  it('plain messages (no Russian text) read no profiles and are sent as before', async () => {
    const { client, tables } = fakeClient([{ user_id: 'RU', chat_id: 1 }], profiles);
    const fetchFn = okFetch();
    await sendTelegramMessages(client, 'T', fetchFn, [{ userId: 'RU', kind: 'meeting_started', text: 'hello' }]);
    expect(sentTexts(fetchFn)).toEqual([[1, 'hello']]);
    expect(tables).toEqual(['telegram_links']);
  });

  it('AC 8: the language is read at send time, so a switch applies to the next message', async () => {
    const one = [localizedMessage('U', 'meeting_started', { en: 'started', ru: 'началась' })];
    const before = fakeClient([{ user_id: 'U', chat_id: 9 }], [{ id: 'U', language: 'en', device_language: null }]);
    const after = fakeClient([{ user_id: 'U', chat_id: 9 }], [{ id: 'U', language: 'ru', device_language: null }]);
    const f1 = okFetch();
    const f2 = okFetch();
    await sendTelegramMessages(before.client, 'T', f1, one);
    await sendTelegramMessages(after.client, 'T', f2, one);
    expect(sentTexts(f1)).toEqual([[9, 'started']]);
    expect(sentTexts(f2)).toEqual([[9, 'началась']]);
  });
});
