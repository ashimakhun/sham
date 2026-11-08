// ARU-108: the English / Russian text catalog. Every text lives in en.json and ru.json under the same ID, with a
// note per ID in notes.json (screen and where on it) for the product owner's spreadsheet. `npm test` checks the three
// files have the same IDs, that no Russian text or note is empty and that the {placeholders} match
// (__tests__/aru108-catalog.test.ts).
//
// Plurals: an ID used with a count has forms `<id>_one`, `<id>_few`, `<id>_many` (Russian) and `<id>_one`,
// `<id>_other` (English); t(id, { count }) picks the form, without depending on Intl.PluralRules.
import { getLocales } from 'expo-localization';

import en from './en.json';
import ru from './ru.json';

export type Language = 'en' | 'ru';
export const LANGUAGES: Language[] = ['en', 'ru'];
export type TextId = keyof typeof en;
type Params = Record<string, string | number>;

const catalogs: Record<Language, Record<string, string>> = { en, ru };

export const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'ru';

// ARU-109: the language the app shows right now, for helpers that run outside a component (the shared confirmation's
// Cancel button, theme.ts's dates, the "Deleted account" fallback). LanguageProvider sets it while rendering, before
// the screens below it render; English until then (and in tests without a provider).
let current: Language = 'en';
export const currentLanguage = (): Language => current;
export function setCurrentLanguage(lang: Language) {
  current = lang;
}

/** AC 2: Russian when the phone's (or browser's) first preferred language is Russian, any region; else English. */
export function languageFromLocale(tag: string | null | undefined): Language {
  return /^ru(?:[-_]|$)/i.test(tag ?? '') ? 'ru' : 'en';
}

/** The phone's language (expo-localization); English when it can't be read. */
export function phoneLanguage(): Language {
  try {
    const first = getLocales()[0];
    return languageFromLocale(first?.languageCode ?? first?.languageTag);
  } catch {
    return 'en';
  }
}

/** Russian: one (1, 21, 101), few (2–4, 22–24), many (0, 5–20, 25…). English: one (1), other. */
export function pluralForm(lang: Language, count: number): 'one' | 'few' | 'many' | 'other' {
  const n = Math.abs(Math.trunc(count));
  if (lang === 'en') return n === 1 ? 'one' : 'other';
  const last = n % 10;
  const lastTwo = n % 100;
  if (last === 1 && lastTwo !== 11) return 'one';
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'few';
  return 'many';
}

const fill = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all)) : text;

function lookup(lang: Language, id: string, params?: Params): string | undefined {
  const catalog = catalogs[lang];
  if (params && typeof params.count === 'number') {
    const form = pluralForm(lang, params.count);
    const plural = catalog[`${id}_${form}`] ?? catalog[`${id}_other`] ?? catalog[`${id}_many`];
    if (plural) return plural;
  }
  return catalog[id] || undefined;
}

/**
 * The text for `id` in `lang`, with {placeholders} filled. AC 8: a text missing in Russian falls back to English; an
 * ID missing everywhere shows a generic text, never the raw ID.
 */
export function translate(lang: Language, id: TextId | string, params?: Params): string {
  const text = lookup(lang, id, params) ?? lookup('en', id, params) ?? lookup(lang, 'common.genericError');
  return fill(text ?? 'Something went wrong. Please try again.', params);
}

/**
 * Messages the store throws in English on the screens moved to the catalog (AC 7, 7a), keyed by their English text.
 * Some carry a value, filled the same way the store fills it.
 */
const MESSAGE_IDS: [TextId, Params?][] = [
  ['common.genericError'],
  ['auth.invalidCredentials'],
  ['auth.userExists'],
  ['auth.emailNotConfirmed'],
  ...Array.from({ length: 30 }, (_, i): [TextId, Params] => ['auth.weakPassword', { min: i + 1 }]),
  ['auth.rateLimited'],
  ['auth.network'],
  ['auth.samePassword'],
  ['auth.wrongCurrentPassword'],
  ['auth.codeInvalid'],
  ['auth.signedOut'],
  ['auth.signInAgain'],
  ['profile.nameTooLong', { max: 80 }],
  ['profile.nameEmpty'],
  ['profile.nameNotSaved'],
  ['profile.waitingApproval'],
  ['profile.languageSaveFailed'],
  ['signIn.accountDeleted'],
];
/**
 * ARU-109 AC 3: messages the app raises on the Homework, Courses, meetings and disciplines screens (the store's own
 * checks and the shared photo texts), keyed by their English text like MESSAGE_IDS.
 */
const APP_MESSAGE_IDS: [TextId, Params?][] = [
  ['errors.noLongerListener'],
  ['errors.feedbackExists'],
  ['errors.notListener'],
  ['errors.alreadySent'],
  ['errors.deadlinePast'],
  ['errors.meetingHasHomework'],
  ['errors.ownHomework'],
  ['errors.disciplineNameEmpty'],
  ['errors.disciplineNameTooLong', {'max': 100}],
  ['errors.disciplineExists'],
  ['errors.disciplineNotFound'],
  ['errors.notesTooLong'],
  ['errors.signInAgain'],
  ['errors.chooseStars'],
  ['errors.feedbackEmpty'],
  ['errors.feedbackTooLong'],
  ['errors.coursePhotosLeft'],
  ['errors.coursePaymentProofsLeft'],
  ['errors.disciplinePhotosLeft'],
  ['errors.disciplinePaymentProofsLeft'],
  ['errors.onlyTeacher'],
  ['errors.onlyMentor'],
  ['errors.onlyTeacherOrMentor'],
  ['errors.onlyMentorOrTeacher'],
  ['errors.onlyStudentOrMentor'],
  ['photo.unavailable'],
  ['photo.loadError'],
  ['photo.noLink'],
  ['photo.prepareError'],
  ['photo.tooLarge'],
  ['disciplines.hidden'],
  ['common.deletedAccount'],
  ['files.pdfRule'],
  ['files.openFailed'],
  ['files.nameEmpty'],
  ['files.nameTooLong'],
  ['files.descriptionTooLong'],
  ['billing.daysRange'],
  ['billing.daysOrder'],
  ['payments.proofRule'],
  ['payments.proofLoadError'],
  ['payments.photoPermission'],
  ['payments.noLongerPaid'],
  ['payments.invalidMonth'],
  ['payments.noProofLink'],
  ['deleteAccount.wrongPassword'],
  ['deleteAccount.offline'],
  ['deleteAccount.failed'],
  ['deleteAccount.teacherCant'],
  ['errors.notSignedIn'],
  ['materials.cantDeleteMaterial'],
  ['materials.cantEditFile'],
  ['materials.notFound'],
  ['materials.cantDeleteFile'],
  ['materials.noFileLink'],
  ['telegram.linkFailed'],
];
/**
 * ARU-113: app messages that carry a value only known at run time; the named groups fill the text's placeholders.
 * The English text must match what the app (and account_deletion_problem() in 0040) builds.
 */
const APP_MESSAGE_PATTERNS: [RegExp, TextId][] = [
  [/^You own courses: (?<titles>.+)\. Ask the teacher or a mentor to change their owner first\.$/s, 'deleteAccount.ownedCourses'],
];
const byEnglish = new Map<string, readonly [TextId, Params | undefined]>();
const register = (entries: [TextId, Params?][]) => {
  for (const [id, params] of entries) byEnglish.set(translate('en', id, params), [id, params] as const);
};
register(MESSAGE_IDS);
register(APP_MESSAGE_IDS);

/**
 * ARU-109 AC 3: an app message in the chosen language when the app knows it; any other message (a database error,
 * until ARU-111) is shown exactly as it came. Used by ErrorText, so every screen's errors go through it.
 */
export function translateKnown(lang: Language, message: string): string {
  const known = byEnglish.get(message);
  if (known) return translate(lang, known[0], known[1]);
  for (const [pattern, id] of APP_MESSAGE_PATTERNS) {
    const match = pattern.exec(message);
    if (match) return translate(lang, id, match.groups);
  }
  return message;
}

/**
 * AC 7a: an error message as the user should read it. A message the app knows is shown in the chosen language. Any
 * other message (the server's own Auth text) stays as it is in English and becomes the generic text in Russian, so no
 * English appears on a Russian screen. No message at all: the generic text.
 */
export function translateMessage(lang: Language, message: string | null | undefined): string {
  if (!message) return translate(lang, 'common.genericError');
  const known = byEnglish.get(message);
  if (known) return translate(lang, known[0], known[1]);
  return lang === 'en' ? message : translate(lang, 'common.genericError');
}

// A bad date reads "Invalid Date" as toLocaleDateString did, instead of throwing (Intl throws a RangeError).
const INVALID = 'Invalid Date';

const LOCALE: Record<Language, string> = { en: 'en-GB', ru: 'ru-RU' };

function parts(lang: Language, date: Date, options: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(LOCALE[lang], options).formatToParts(date)) out[p.type] = p.value;
  return out;
}

/**
 * AC 9: a date in the chosen language, never the phone's locale: "12 May 2026" / "12 мая 2026". `timeZone` defaults
 * to the device's.
 */
export function formatDateIn(lang: Language, value: Date | string, timeZone?: string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return INVALID;
  const p = parts(lang, date, { day: 'numeric', month: lang === 'ru' ? 'long' : 'short', year: 'numeric', timeZone });
  return `${p.day} ${p.month} ${p.year}`;
}

/** AC 9: a short weekday with the day: "Mon, 12 May" / "пн, 12 мая". */
export function formatWeekdayDateIn(lang: Language, value: Date | string, timeZone?: string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return INVALID;
  const p = parts(lang, date, { weekday: 'short', day: 'numeric', month: lang === 'ru' ? 'long' : 'short', timeZone });
  return `${p.weekday.replace(/\.$/, '')}, ${p.day} ${p.month}`;
}

/** AC 9: a date with the time: "12 May 2026, 14:05" / "12 мая 2026, 14:05" (24-hour in both). */
export function formatDateTimeIn(lang: Language, value: Date | string, timeZone?: string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return INVALID;
  const p = parts(lang, date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  return `${formatDateIn(lang, date, timeZone)}, ${p.hour}:${p.minute}`;
}

/** ARU-109 AC 4: a number in the chosen language: "10,000" / "10 000". */
export function formatNumberIn(lang: Language, value: number) {
  return new Intl.NumberFormat(LOCALE[lang]).format(value);
}
