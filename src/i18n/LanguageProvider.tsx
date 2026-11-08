import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useStore } from '@/lib/store';

import { I18nContext, make, useI18n } from './context';
import { isLanguage, type Language, phoneLanguage, setCurrentLanguage } from './index';

export { useI18n };

/** The language last shown on this device (AC 6 and the "profile not loaded yet" edge case). */
export const LAST_LANGUAGE_KEY = 'sham.language';

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LAST_LANGUAGE_KEY);
        if (alive && isLanguage(saved)) setLastShown(saved);
      } catch {
        // No storage (private browsing): the phone language it is.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const account = currentUser ? (currentUser.language ?? phone) : null;
  const lang: Language = account ?? lastShown ?? phone;

  useEffect(() => {
    // Only a language decided by a loaded account is remembered for the sign-in screen.
    if (!account) return;
    AsyncStorage.setItem(LAST_LANGUAGE_KEY, account).catch(() => {});
  }, [account]);

  // Before the screens below render, so helpers outside components (confirmAction, formatDate) use the same language.
  setCurrentLanguage(lang);
  const value = useMemo(() => make(lang), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
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
