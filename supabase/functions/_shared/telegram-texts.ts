// ARU-110: the Telegram notification texts in English and Russian, with a note per text (which notification, when
// it's sent) for the product owner's spreadsheet. Kept apart from the app catalog (src/i18n), which Edge Functions
// can't import. telegram-texts.test.ts checks every text has both languages and a note, and the same {placeholders}.
// A later notification kind adds its texts here (ARU-112's photo-deletion warning did).
//
// The bot's own replies (/start, /stop in telegram-bot.ts) stay English by product owner decision (ARU-110 analysis
// comment, 2026-11-08), so they are not in this catalog.

export type TelegramLanguage = 'en' | 'ru';

type Entry = { en: string; ru: string; note: string };

export const TELEGRAM_TEXTS = {
  meetingStarted: {
    en: '{course} meeting has started',
    ru: 'Встреча курса {course} началась',
    note: 'Meeting started · to every listener when a meeting of the course starts',
  },
  chatMessage: {
    en: 'New message in the {course} chat',
    ru: 'Новое сообщение в чате курса {course}',
    note: 'Chat messages · to the course chat members (not the sender) for each new message',
  },
  generalChat: {
    en: 'New message in the general chat',
    ru: 'Новое сообщение в общем чате',
    note: 'General chat · to everyone (not the sender) for each new general chat message',
  },
  homeworkReviewed: {
    en: 'Your homework for {course} was reviewed',
    ru: 'Ваше домашнее задание по курсу {course} проверено',
    note: 'Homework reviewed · to the student when a mentor or the teacher checks their homework',
  },
  newHomework: {
    en: 'New homework assigned to you in {course}',
    ru: 'Вам задано новое домашнее задание по курсу {course}',
    note: 'New homework · to the listeners when homework is assigned to a completed meeting',
  },
  homeworkSubmitted: {
    en: 'New homework to check from {name} in {course}: {assignment}',
    ru: 'Новое домашнее задание на проверку от {name} по курсу {course}: {assignment}',
    note: 'Homework submitted · to the course owner when a listener sends homework',
  },
  newAccount: {
    en: 'New account waiting for your approval: {name}. Open Sham → Manage roles to accept or decline.',
    ru: 'Новый аккаунт ждёт вашего подтверждения: {name}. Откройте Sham → Управление ролями, чтобы принять или отклонить.',
    note: 'New accounts · to the teacher when someone signs up',
  },
  newBlogPost: {
    en: 'New blog post from {name}: {title}',
    ru: 'Новая запись в блоге от {name}: {title}',
    note: 'New materials · to everyone who may read it when a blog post is published',
  },
  newKnowledgeFile: {
    en: 'New file in the knowledge base from {name}: {title}',
    ru: 'Новый файл в базе знаний от {name}: {title}',
    note: 'New materials · to everyone who may read it when a PDF is added to the knowledge base',
  },
  // ARU-112 / ARU-133: the photo-deletion warning, in three plural forms (Russian one / few / many; English uses
  // "photo" for 1 and "photos" otherwise). photo-deletion.ts picks the form and fills {count} and {date}.
  photoDeletionOne: {
    en: '{count} homework photo will be deleted on {date}. Open Sham → Homework to download them.',
    ru: '{count} фотография домашнего задания будет удалена {date}. Откройте Sham → Задания, чтобы скачать её.',
    note: 'Photo deletion · to the sender, 30 and 7 days before their photos are deleted (count ends in 1, not 11)',
  },
  photoDeletionFew: {
    en: '{count} homework photos will be deleted on {date}. Open Sham → Homework to download them.',
    ru: '{count} фотографии домашних заданий будут удалены {date}. Откройте Sham → Задания, чтобы скачать их.',
    note: 'Photo deletion · to the sender, 30 and 7 days before their photos are deleted (count ends in 2–4, not 12–14)',
  },
  photoDeletionMany: {
    en: '{count} homework photos will be deleted on {date}. Open Sham → Homework to download them.',
    ru: '{count} фотографий домашних заданий будут удалены {date}. Откройте Sham → Задания, чтобы скачать их.',
    note: 'Photo deletion · to the sender, 30 and 7 days before their photos are deleted (any other count)',
  },
} satisfies Record<string, Entry>;

export type TelegramTextId = keyof typeof TELEGRAM_TEXTS;

/**
 * A text with its {placeholders} filled in one pass, so a value that itself contains "{course}" is shown as typed.
 * Values are plain text (messages are sent without parse_mode).
 */
export function telegramText(lang: TelegramLanguage, id: TelegramTextId, params: Record<string, string> = {}) {
  const template: string = TELEGRAM_TEXTS[id][lang] || TELEGRAM_TEXTS[id].en;
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? params[name] : all));
}

/** The text in every language, for a message that each recipient gets in their own (AC 4). */
export function telegramTexts(id: TelegramTextId, params: Record<string, string> = {}) {
  return { en: telegramText('en', id, params), ru: telegramText('ru', id, params) };
}

/**
 * AC 1: the language a user's notifications are sent in: the one they chose in Profile, else the phone language the
 * app saved on their account (device_language), else English.
 */
export function recipientLanguage(profile: { language?: unknown; device_language?: unknown } | undefined): TelegramLanguage {
  const pick = (v: unknown) => (v === 'en' || v === 'ru' ? v : null);
  return pick(profile?.language) ?? pick(profile?.device_language) ?? 'en';
}
