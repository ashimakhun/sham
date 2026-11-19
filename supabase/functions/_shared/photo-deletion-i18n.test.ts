/**
 * @jest-environment node
 */
// ARU-133: the photo-deletion warning in each sender's language (ARU-110's notification catalog), with Russian plurals and
// dates; English is unchanged.
import { formatUtcDay, photoDeletionMessages, photoDeletionText } from './photo-deletion';
import { sendPushMessages } from './push';
import { pushClient, pushFetch } from './push-test-helpers';

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
  const { client } = pushClient(
    [
      { user_id: 'RU', chat_id: 1, notify_photo_deletion: true },
      { user_id: 'EN', chat_id: 2, notify_photo_deletion: true },
    ],
    [{ id: 'RU', language: 'ru' }, { id: 'EN', language: null, device_language: null }],
  );
  const push = pushFetch();
  const result = await sendPushMessages(client, push.fetch, messages, { sleep: async () => {} });
  expect(result.sent).toBe(2);
  const bodies = Object.fromEntries(push.sent());
  expect(bodies[1]).toMatch(/^2 фотографии домашних заданий будут удалены 8 декабря 2026/);
  expect(bodies[2]).toMatch(/^1 homework photo will be deleted on 8 Dec 2026/);
});
