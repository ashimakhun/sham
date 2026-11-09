/**
 * @jest-environment node
 */
// ARU-133: the photo-deletion warning in each sender's language (ARU-110's Telegram catalog), with Russian plurals and
// dates; English is unchanged.
import { formatUtcDay, photoDeletionMessages, photoDeletionText } from './photo-deletion';
import { sendTelegramMessages, type ServiceClient } from './telegram';

describe('texts', () => {
  it.each([
    [1, '1 фотография домашнего задания будет удалена 8 декабря 2026. Откройте Sham → Задания, чтобы скачать её.'],
    [2, '2 фотографии домашних заданий будут удалены 8 декабря 2026. Откройте Sham → Задания, чтобы скачать их.'],
    [5, '5 фотографий домашних заданий будут удалены 8 декабря 2026. Откройте Sham → Задания, чтобы скачать их.'],
    [11, '11 фотографий домашних заданий будут удалены 8 декабря 2026. Откройте Sham → Задания, чтобы скачать их.'],
    [21, '21 фотография домашнего задания будет удалена 8 декабря 2026. Откройте Sham → Задания, чтобы скачать её.'],
    [22, '22 фотографии домашних заданий будут удалены 8 декабря 2026. Откройте Sham → Задания, чтобы скачать их.'],
  ])('Russian, %i', (n, text) => {
    expect(photoDeletionText(n, '2026-12-08', 'ru')).toBe(text);
  });

  it('English is exactly as ARU-112 set it', () => {
    expect(photoDeletionText(1, '2026-12-08')).toBe('1 homework photo will be deleted on 8 Dec 2026. Open Sham → Homework to download them.');
    expect(photoDeletionText(3, '2027-01-03', 'en')).toBe('3 homework photos will be deleted on 3 Jan 2027. Open Sham → Homework to download them.');
  });

  it('dates are the UTC day in both languages', () => {
    expect(formatUtcDay('2026-05-12', 'ru')).toBe('12 мая 2026');
    expect(formatUtcDay('2026-12-31')).toBe('31 Dec 2026');
  });
});

it('each sender gets the warning in their own language (Russian, then English by default)', async () => {
  const messages = photoDeletionMessages([
    { user_id: 'RU', photo_count: 2, earliest: '2026-12-08' },
    { user_id: 'EN', photo_count: 1, earliest: '2026-12-08' },
  ]);
  const client = {
    from: (table: string) => ({
      select: () => ({
        in: async () =>
          table === 'profiles'
            ? { data: [{ id: 'RU', language: 'ru' }, { id: 'EN', language: null, device_language: null }], error: null }
            : {
                data: [
                  { user_id: 'RU', chat_id: 1, notify_photo_deletion: true },
                  { user_id: 'EN', chat_id: 2, notify_photo_deletion: true },
                ],
                error: null,
              },
      }),
      delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
    }),
  } as unknown as ServiceClient;
  const fetchFn = jest.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
  const result = await sendTelegramMessages(client, 'tok', fetchFn, messages, { sleep: async () => {} });
  expect(result.sent).toBe(2);
  const bodies = (fetchFn as jest.Mock).mock.calls.map((c) => JSON.parse((c as [string, RequestInit])[1].body as string));
  expect(bodies.find((b) => b.chat_id === 1).text).toMatch(/^2 фотографии домашних заданий будут удалены 8 декабря 2026/);
  expect(bodies.find((b) => b.chat_id === 2).text).toMatch(/^1 homework photo will be deleted on 8 Dec 2026/);
});
