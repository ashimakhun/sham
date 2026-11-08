import { currentLanguage, type Language, translate } from '@/i18n';

/** How a new-message count reads on a badge (ARU-31): "99+" above 99. */
export function formatUnread(count: number) {
  return count > 99 ? '99+' : String(count);
}

/**
 * Adds the count to a screen-reader label, e.g. "Open chat for Algebra, 3 new messages"; unchanged at 0 (ARU-31). In
 * the app's language (ARU-109 AC 4).
 */
export function withUnreadLabel(label: string, count: number, lang: Language = currentLanguage()) {
  if (count <= 0) return label;
  return translate(lang, 'unread.withMessages', { label, count: formatUnread(count) === '99+' ? 100 : count, n: formatUnread(count) });
}

/** ARU-73: the Homework tab's Listener switch label, e.g. "Listener, 3 new homework"; just "Listener" at 0. */
export function listenerTabLabel(newCount: number, lang: Language = currentLanguage()) {
  return newCount > 0
    ? translate(lang, 'unread.listenerNew', { count: newCount > 99 ? 100 : newCount, n: formatUnread(newCount) })
    : translate(lang, 'unread.listener');
}
