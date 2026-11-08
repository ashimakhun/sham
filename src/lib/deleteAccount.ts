// ARU-75: deleting your own account. Texts shared by the Delete account screen, the store and the screens that show
// people.
import { currentLanguage, translate } from '@/i18n';

/** Shown wherever a person is referenced who deleted their account (the reference is empty in the database). */
export const DELETED_ACCOUNT = 'Deleted account';

/** Shown on the sign-in screen after this device's account was deleted (here or on another device, AC 4, AC 9). */
export const ACCOUNT_DELETED = 'Your account was deleted';

export const WRONG_PASSWORD = 'Password is incorrect';
export const DELETE_OFFLINE = "Couldn't reach Sham. Check your connection and try again.";
export const DELETE_FAILED = "Your account couldn't be deleted. Please try again.";
export const TEACHER_CANT_DELETE = "The teacher's account can't be deleted.";

/** AC 2: what will happen. "Deleted account" is shown in bold. */
export const DELETE_EXPLANATION_BEFORE =
  'Your profile, homework and photos, course memberships, attendance marks, feedback, likes, materials and PDFs you ' +
  'shared, and your Telegram link are deleted. Your chat messages and the work you did for others (checked homework, ' +
  'meetings, notes) stay, shown as ';
export const DELETE_EXPLANATION_AFTER = ". This can't be undone.";

/** AC 6: the same message as the database (account_deletion_problem() in 0040). Null when the user owns nothing. */
export function ownedCoursesProblem(titles: string[]): string | null {
  if (!titles.length) return null;
  const sorted = [...titles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `You own courses: ${sorted.join(', ')}. Ask the teacher or a mentor to change their owner first.`;
}

/**
 * The name to show for a person reference (AC 8). An empty reference means the account was deleted: "Deleted account".
 * A reference to a profile this device can't read keeps the screen's usual fallback.
 */
export function personName(id: string | null | undefined, user: { name: string } | undefined, fallback: string) {
  if (id == null) return translate(currentLanguage(), 'common.deletedAccount');
  return user?.name ?? fallback;
}
