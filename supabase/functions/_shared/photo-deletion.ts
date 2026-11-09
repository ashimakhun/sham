// ARU-112: the photo-deletion Edge Function's logic. Called once a day by a pg_cron job (migration 0053) with the
// secret in the x-cron-secret header. One run:
//   1. sets the deletion start date if it is still empty (start_photo_deletion(): today + 30 days, AC 1);
//   2. deletes leftover files from failed sends (unreferenced, older than 24 hours; every run, the first included, AC 7);
//   3. deletes the photos that are due (not on the first run, AC 1), file first and then the row (AC 2, AC 3);
//   4. records the 30-day and 7-day marks and sends one Telegram message per sender (AC 4).
// No Deno-only imports: Supabase, Storage and Telegram are passed in, so Jest can test it.

import { localizedMessage, type SendResult, type TelegramMessage } from './telegram.ts';
import { type TelegramLanguage, telegramText } from './telegram-texts.ts';
import { timingSafeEqual } from './telegram-bot.ts';

export type DuePhoto = { homework_id: string; photo_path: string };
export type PhotoWarning = { user_id: string; photo_count: number; earliest: string };

export type PhotoDeletionDeps = {
  /** start_photo_deletion(): the start date and whether this call set it. */
  start: () => Promise<{ start_date: string; first_run: boolean }>;
  /** leftover_homework_photos(max). */
  leftovers: (max: number) => Promise<string[]>;
  /** due_homework_photos(max), most overdue first. */
  due: (max: number) => Promise<DuePhoto[]>;
  /**
   * Deletes these paths from the homework bucket. Resolves when Storage accepted the call (a file that was already
   * missing counts as deleted, AC 3); throws when the whole call failed.
   */
  remove: (paths: string[]) => Promise<void>;
  /** mark_homework_photos_removed(ids, paths): how many rows changed. */
  markRemoved: (photos: DuePhoto[]) => Promise<number>;
  /** claim_photo_deletion_warnings(). */
  claimWarnings: () => Promise<PhotoWarning[]>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** How many due photos one run handles (edge case: many due at once; the rest go next run, oldest first). */
export const MAX_PHOTOS_PER_RUN = 1000;
/** How many leftover files one run removes. */
export const MAX_LEFTOVERS_PER_RUN = 1000;
/** Paths per Storage remove call. */
export const REMOVE_CHUNK = 100;

/** What a run returns (and logs), so it can be checked from net._http_response (analysis note 4). */
export type PhotoDeletionReport = {
  start_date_set: boolean;
  start_date: string;
  deleted: number;
  failed: number;
  leftovers_deleted: number;
  leftovers_failed: number;
  warnings_sent: number;
  warnings_skipped: number;
  warnings_failed: number;
};

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A UTC date (YYYY-MM-DD) as the app shows it (ARU-108 dates): "8 Dec 2026" in English, "8 декабря 2026" in Russian.
 * Built by hand, so it doesn't depend on the server's locale data or time zone.
 */
export function formatUtcDay(day: string, lang: TelegramLanguage = 'en') {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${(lang === 'ru' ? RU_MONTHS : EN_MONTHS)[m - 1]} ${y}`;
}

/** Russian plural form for a count: one (1, 21, …), few (2–4, 22–24, …) or many (0, 5–20, 11–14, …). */
function pluralForm(n: number): 'One' | 'Few' | 'Many' {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'One';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'Few';
  return 'Many';
}

/** AC 4: the message text in one language (English: "photo" for 1, "photos" otherwise). */
export function photoDeletionText(count: number, earliest: string, lang: TelegramLanguage = 'en') {
  const form = lang === 'en' ? (count === 1 ? 'One' : 'Many') : pluralForm(count);
  return telegramText(lang, `photoDeletion${form}`, { count: String(count), date: formatUtcDay(earliest, lang) });
}

/** One message per sender, in their own language (ARU-110: profiles.language, then device_language, then English). */
export function photoDeletionMessages(warnings: PhotoWarning[]): TelegramMessage[] {
  return warnings
    .filter((w) => w.photo_count > 0)
    .map((w) =>
      localizedMessage(w.user_id, 'photo_deletion', {
        en: photoDeletionText(w.photo_count, w.earliest, 'en'),
        ru: photoDeletionText(w.photo_count, w.earliest, 'ru'),
      }),
    );
}

const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 without the right secret (AC 9). A failure in one step is logged and the other steps still run,
 * except that nothing is deleted or warned when the start date can't be read (500).
 */
export async function handlePhotoDeletionRequest(
  request: Request,
  secret: string,
  deps: PhotoDeletionDeps,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const given = request.headers.get('x-cron-secret') ?? '';
  if (!secret || !timingSafeEqual(given, secret)) return new Response('Unauthorized', { status: 401 });
  const log = (line: string) => deps.log?.(`photo-deletion: ${line}`);

  let start: { start_date: string; first_run: boolean };
  try {
    start = await deps.start();
  } catch (e) {
    log(`start date failed: ${message(e)}`);
    return json({ error: message(e) }, 500);
  }
  const report: PhotoDeletionReport = {
    start_date_set: start.first_run,
    start_date: start.start_date,
    deleted: 0,
    failed: 0,
    leftovers_deleted: 0,
    leftovers_failed: 0,
    warnings_sent: 0,
    warnings_skipped: 0,
    warnings_failed: 0,
  };

  // AC 7: leftovers, on every run.
  try {
    const leftovers = await deps.leftovers(MAX_LEFTOVERS_PER_RUN);
    for (const part of chunks(leftovers, REMOVE_CHUNK)) {
      try {
        await deps.remove(part);
        report.leftovers_deleted += part.length;
      } catch (e) {
        report.leftovers_failed += part.length;
        log(`leftover delete failed for ${part.length} file(s): ${message(e)}`);
      }
    }
  } catch (e) {
    log(`leftover list failed: ${message(e)}`);
  }

  // AC 1 / AC 2 / AC 3: due photos, never on the first run. File first; a failed call keeps the paths for next run.
  if (!start.first_run) {
    try {
      const due = await deps.due(MAX_PHOTOS_PER_RUN);
      for (const part of chunks(due, REMOVE_CHUNK)) {
        try {
          await deps.remove(part.map((p) => p.photo_path));
        } catch (e) {
          report.failed += part.length;
          log(`photo delete failed for ${part.length} photo(s): ${message(e)}`);
          continue;
        }
        try {
          report.deleted += await deps.markRemoved(part);
        } catch (e) {
          // The files are gone but the rows still point at them: next run lists them again, and deleting a missing
          // file succeeds, so they are marked then (AC 3).
          report.failed += part.length;
          log(`marking ${part.length} photo(s) removed failed: ${message(e)}`);
        }
      }
    } catch (e) {
      log(`due list failed: ${message(e)}`);
    }
  }

  // AC 4: warnings. The marks are recorded before sending, so a failed message is never sent again (analysis note 2).
  try {
    const messages = photoDeletionMessages(await deps.claimWarnings());
    if (messages.length) {
      const sent = await deps.send(messages);
      report.warnings_sent = sent.sent;
      report.warnings_skipped = sent.skipped;
      report.warnings_failed = sent.failed.length;
    }
  } catch (e) {
    log(`warnings failed: ${message(e)}`);
  }

  log(
    `start ${report.start_date}${report.start_date_set ? ' (set now)' : ''}, deleted ${report.deleted}, ` +
      `failed ${report.failed}, leftovers ${report.leftovers_deleted} (failed ${report.leftovers_failed}), ` +
      `warnings sent ${report.warnings_sent}, skipped ${report.warnings_skipped}, failed ${report.warnings_failed}`,
  );
  return json(report);
}
