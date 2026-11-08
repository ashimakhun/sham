import { translate } from '@/i18n';

/** Longest name a user can save from the Profile tab (ARU-55), counted as JavaScript string length. Sign-up and the
 *  database don't have this limit, and existing longer names stay as they are. */
export const NAME_MAX = 80;
export const NAME_TOO_LONG = translate('en', 'profile.nameTooLong', { max: NAME_MAX });
/** ARU-108 AC 10. */
export const LANGUAGE_SAVE_FAILED = translate('en', 'profile.languageSaveFailed');

/** Why a name can't be saved (ARU-55), or null when it can. Leading and trailing spaces don't count. */
export function nameProblem(name: string): string | null {
  const text = name.trim();
  if (!text) return translate('en', 'profile.nameEmpty');
  if (text.length > NAME_MAX) return NAME_TOO_LONG;
  return null;
}
