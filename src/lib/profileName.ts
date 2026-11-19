import { translate } from '@/i18n';

/** Longest display name a user can save (ARU-55; at sign-up too since ARU-164, where the database also checks it),
 *  counted as JavaScript string length. Existing longer names stay as they are. */
export const NAME_MAX = 80;
/** ARU-164 AC 10: "Name" is now "Display name". */
export const NAME_TOO_LONG = translate('en', 'profile.displayNameTooLong', { max: NAME_MAX });
/** ARU-108 AC 10. */
export const LANGUAGE_SAVE_FAILED = translate('en', 'profile.languageSaveFailed');

/** Why a name can't be saved (ARU-55), or null when it can. Leading and trailing spaces don't count. */
export function nameProblem(name: string): string | null {
  const text = name.trim();
  if (!text) return translate('en', 'profile.displayNameEmpty');
  if (text.length > NAME_MAX) return NAME_TOO_LONG;
  return null;
}
