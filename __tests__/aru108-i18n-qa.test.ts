/**
 * @jest-environment node
 */
// QA ARU-108: gaps in the dev tests: the shipped catalogs compared directly (same IDs, no empty text, same
// {placeholders}); Russian plurals for 0/1/2/4/5/11–14/21/22/25/101/111 and English 0/1/2; the phone-language rule for
// odd locale tags; a missing ID falls back to English and never shows the raw ID; unknown and empty errors; dates in the
// chosen language regardless of the device locale.
import en from '@/i18n/en.json';
import {
  formatDateIn,
  formatDateTimeIn,
  languageFromLocale,
  pluralForm,
  translate,
  translateMessage,
} from '@/i18n';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';

const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalogs', () => {
  it('en, ru and notes have exactly the same IDs', () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(ru).sort()).toEqual(keys);
    expect(Object.keys(notes).sort()).toEqual(keys);
  });

  it('no text, Russian text or note is empty', () => {
    for (const c of [en, ru, notes] as Record<string, string>[]) {
      for (const [id, v] of Object.entries(c)) expect([id, v.trim().length > 0]).toEqual([id, true]);
    }
  });

  it('every ID has the same {placeholders} in English and Russian', () => {
    for (const id of Object.keys(en) as (keyof typeof en)[]) {
      expect([id, ph((ru as Record<string, string>)[id])]).toEqual([id, ph(en[id])]);
    }
  });

  // Left in Latin on purpose: "Email" (used as is in Russian), the address example, and English's own name.
  const latinOk = ['signIn.email', 'signIn.emailPlaceholder', 'profile.languageEnglish'];
  it('no other Russian text is left untranslated (Latin only)', () => {
    const latinOnly = Object.entries(ru as Record<string, string>).filter(
      ([id, v]) => !latinOk.includes(id) && !/[а-яё]/i.test(v.replace(/\{\w+\}/g, '')),
    );
    expect(latinOnly).toEqual([]);
  });
});

describe('Russian plurals', () => {
  it.each([
    [0, 'many', '0 домашних заданий'],
    [1, 'one', '1 домашнее задание'],
    [2, 'few', '2 домашних задания'],
    [4, 'few', '4 домашних задания'],
    [5, 'many', '5 домашних заданий'],
    [11, 'many', '11 домашних заданий'],
    [12, 'many', '12 домашних заданий'],
    [13, 'many', '13 домашних заданий'],
    [14, 'many', '14 домашних заданий'],
    [21, 'one', '21 домашнее задание'],
    [22, 'few', '22 домашних задания'],
    [25, 'many', '25 домашних заданий'],
    [101, 'one', '101 домашнее задание'],
    [111, 'many', '111 домашних заданий'],
  ] as const)('%i → %s: "%s"', (n, form, text) => {
    expect(pluralForm('ru', n)).toBe(form);
    expect(translate('ru', 'common.homeworkCount', { count: n })).toBe(text);
  });

  it.each([
    [0, 'other'],
    [1, 'one'],
    [2, 'other'],
  ] as const)('English %i → %s', (n, form) => {
    expect(pluralForm('en', n)).toBe(form);
    expect(translate('en', 'common.homeworkCount', { count: n })).toBe(`${n} homework`);
  });
});

describe('phone language', () => {
  it.each([
    ['ru-KZ', 'ru'],
    ['RU', 'ru'],
    ['ru_RU', 'ru'],
    ['ru', 'ru'],
    ['kk-KZ', 'en'],
    ['uk-UA', 'en'],
    ['rus', 'en'],
    ['en-US', 'en'],
    ['', 'en'],
    [null, 'en'],
    [undefined, 'en'],
  ] as const)('%p → %s', (tag, lang) => {
    expect(languageFromLocale(tag)).toBe(lang);
  });
});

describe('fallbacks', () => {
  it('an ID missing from Russian falls back to English; an unknown ID never shows the raw ID', () => {
    const ru2 = translate('ru', 'no.such.id');
    expect(ru2).not.toContain('no.such.id');
    expect(ru2).toBe(translate('ru', 'common.genericError'));
    expect(translate('en', 'no.such.id')).toBe(translate('en', 'common.genericError'));
  });

  it('an unknown error keeps its text in English and becomes the generic text in Russian; empty is generic', () => {
    expect(translateMessage('en', 'Something odd from the server')).toBe('Something odd from the server');
    expect(translateMessage('ru', 'Something odd from the server')).toBe(translate('ru', 'common.genericError'));
    expect(translateMessage('ru', '')).toBe(translate('ru', 'common.genericError'));
    expect(translateMessage('en', null)).toBe(translate('en', 'common.genericError'));
  });

  it('a known English error is translated into Russian', () => {
    expect(translateMessage('ru', en['auth.emailNotConfirmed'])).toBe(ru['auth.emailNotConfirmed']);
  });
});

describe('dates follow the chosen language', () => {
  const d = new Date(Date.UTC(2026, 4, 12, 14, 5));
  it('English and Russian dates', () => {
    expect(formatDateIn('en', d, 'UTC')).toBe('12 May 2026');
    expect(formatDateIn('ru', d, 'UTC')).toBe('12 мая 2026');
    expect(formatDateTimeIn('en', d, 'UTC')).toBe('12 May 2026, 14:05');
    expect(formatDateTimeIn('ru', d, 'UTC')).toBe('12 мая 2026, 14:05');
  });
});
