// ARU-109: the language context on its own, without the store, so shared components (ui.tsx) can read the language
// without loading Supabase (tests render them without a store). LanguageProvider fills it.
import { createContext, useContext } from 'react';

import {
  formatDateIn,
  formatDateTimeIn,
  formatNumberIn,
  formatWeekdayDateIn,
  type Language,
  translate,
  translateKnown,
  translateMessage,
  type TextId,
} from './index';

export type I18n = {
  lang: Language;
  t: (id: TextId | string, params?: Record<string, string | number>) => string;
  /** AC 7a: an error message in the chosen language (see translateMessage). */
  tm: (message: string | null | undefined) => string | null;
  /** ARU-109 AC 3: an app message in the chosen language; anything else (a database error) as it came. */
  te: (message: string | null | undefined) => string | null;
  formatNumber: (value: number) => string;
  formatDate: (value: Date | string) => string;
  formatWeekdayDate: (value: Date | string) => string;
  formatDateTime: (value: Date | string) => string;
};

export const make = (lang: Language): I18n => ({
  lang,
  t: (id, params) => translate(lang, id, params),
  tm: (message) => (message == null ? null : translateMessage(lang, message)),
  te: (message) => (message ? translateKnown(lang, message) : null),
  formatNumber: (value) => formatNumberIn(lang, value),
  formatDate: (value) => formatDateIn(lang, value),
  formatWeekdayDate: (value) => formatWeekdayDateIn(lang, value),
  formatDateTime: (value) => formatDateTimeIn(lang, value),
});

// Outside a provider (tests of a single component, for example): English.
export const I18nContext = createContext<I18n>(make('en'));

export function useI18n() {
  return useContext(I18nContext);
}

/**
 * ARU-189: the Create account form's Language switch, before any account exists. `picked` is the language picked on
 * that form (remembered on this device, analysis note 2), or null when the switch wasn't touched (AC 7). `choose`
 * changes the language shown on this device at once (AC 3, AC 4) and saves nothing on a server. LanguageProvider
 * fills it; outside one (tests of a single screen) the switch does nothing.
 */
export type FormLanguage = { picked: Language | null; choose: (lang: Language) => void };
export const FormLanguageContext = createContext<FormLanguage>({ picked: null, choose: () => {} });

export function useFormLanguage() {
  return useContext(FormLanguageContext);
}
