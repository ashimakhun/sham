import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useStore } from '@/lib/store';

import { FormLanguageContext, I18nContext, make, useI18n } from './context';
import { isLanguage, type Language, phoneLanguage, setCurrentLanguage } from './index';

export { useI18n };

/** The language last shown on this device (AC 6 and the "profile not loaded yet" edge case). */
export const LAST_LANGUAGE_KEY = 'sham.language';
/**
 * ARU-189 (analysis note 2): the language picked with the Create account form's switch, kept until a signed-in
 * account's language replaces it. Separate from LAST_LANGUAGE_KEY, which an earlier account may have set: that one
 * alone counts as not touched (AC 7).
 */
export const FORM_LANGUAGE_KEY = 'sham.formLanguage';

/**
 * ARU-108: which language the app shows.
 *   signed in with a saved choice      → that choice (AC 4), on every device
 *   signed in, never chose              → the phone language (AC 5)
 *   signed in, profile not loaded yet   → the language last shown on this device, then the account's (edge case)
 *   signed out                          → the language last shown on this device, else the phone's (AC 6)
 * Switching re-renders every screen at once (AC 3): screens read the language from this context.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useStore();
  const [phone] = useState(phoneLanguage);
  const [lastShown, setLastShown] = useState<Language | null>(null);
  // ARU-189: picked on the Create account form (null: not touched).
  const [picked, setPicked] = useState<Language | null>(null);
  // A tap on the form before storage has been read wins over what storage had.
  const choseHere = useRef(false);

  const account = currentUser ? (currentUser.language ?? phone) : null;
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);
  // ARU-189 AC 4 / AC 6: a signed-in account's language replaces the form's pick (adjusted while rendering, as React
  // recommends for state that follows a value).
  // ARU-202 / ARU-108 AC 6: the account's language also becomes the language last shown on this device, so the
  // sign-in screen keeps it after sign-out instead of going back to an older pick or stored value.
  const [pickAccount, setPickAccount] = useState<Language | null>(null);
  if (pickAccount !== account) {
    setPickAccount(account);
    if (account) {
      setPicked(null);
      setLastShown(account);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [saved, form] = await Promise.all([
          AsyncStorage.getItem(LAST_LANGUAGE_KEY),
          AsyncStorage.getItem(FORM_LANGUAGE_KEY),
        ]);
        if (!alive || choseHere.current) return;
        // ARU-202: once an account has decided the language, storage read late must not replace it.
        if (isLanguage(saved) && !accountRef.current) setLastShown(saved);
        // ARU-189 AC 4: a pick from an earlier visit shows again and still counts as picked (note 2), unless an
        // account has signed in meanwhile (its language replaces it).
        if (isLanguage(form) && !accountRef.current) {
          setLastShown(form);
          setPicked(form);
        }
      } catch {
        // No storage (private browsing): the phone language it is.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const lang: Language = account ?? lastShown ?? phone;

  useEffect(() => {
    // Only a language decided by a loaded account is remembered for the sign-in screen.
    if (!account) return;
    AsyncStorage.setItem(LAST_LANGUAGE_KEY, account).catch(() => {});
    // ARU-189 AC 4 / AC 6: the form's pick is forgotten on this device too.
    AsyncStorage.removeItem(FORM_LANGUAGE_KEY).catch(() => {});
  }, [account]);

  // ARU-189 AC 3 / AC 4: the Create account form's switch. Changes this device's language at once; nothing is sent
  // until Create account (AC 5). With no storage it still works for this visit (edge case).
  const chooseFormLanguage = useCallback((next: Language) => {
    choseHere.current = true;
    setLastShown(next);
    setPicked(next);
    AsyncStorage.setItem(LAST_LANGUAGE_KEY, next).catch(() => {});
    AsyncStorage.setItem(FORM_LANGUAGE_KEY, next).catch(() => {});
  }, []);
  const form = useMemo(() => ({ picked, choose: chooseFormLanguage }), [picked, chooseFormLanguage]);

  // Before the screens below render, so helpers outside components (confirmAction, formatDate) use the same language.
  setCurrentLanguage(lang);
  const value = useMemo(() => make(lang), [lang]);
  return (
    <I18nContext.Provider value={value}>
      <FormLanguageContext.Provider value={form}>{children}</FormLanguageContext.Provider>
    </I18nContext.Provider>
  );
}


/** The Language switch (AC 3, AC 10): saves on the account; on failure the language stays as it was. */
export function useLanguageSwitch() {
  const { setLanguage } = useStore();
  const { lang } = useI18n();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // One update per tap, even before the disabled state has rendered.
  const inFlight = useRef(false);
  const choose = useCallback(
    async (next: Language) => {
      if (inFlight.current || next === lang) return;
      inFlight.current = true;
      setFailed(false);
      setSaving(true);
      try {
        await setLanguage(next);
      } catch {
        setFailed(true);
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
    },
    [lang, setLanguage],
  );
  return { lang, saving, failed, choose };
}
