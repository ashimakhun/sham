import type { CourseBilling, User } from './types';

/** ARU-65: an approved mentor with Accountant on (mirrors is_accountant() in 0032). */
export function isAccountant(user: User | null | undefined) {
  return !!user && user.role === 'mentor' && !!user.isAccountant && (user.accessStatus ?? 'approved') === 'approved';
}

/** Who sees paid courses and changes their periods: accountants and the teacher. */
export function canSeeBilling(user: User | null | undefined) {
  return isAccountant(user) || user?.role === 'teacher';
}

/** "Pays 1–5 of each month" (one day: "Pays 5 of each month"). */
export function periodText(b: Pick<CourseBilling, 'startDay' | 'endDay'>) {
  const days = b.startDay === b.endDay ? `${b.startDay}` : `${b.startDay}–${b.endDay}`;
  return `Pays ${days} of each month`;
}

export const DEFAULT_PERIOD = { startDay: 1, endDay: 5 };
export const BILLING_DAY_MIN = 1;
export const BILLING_DAY_MAX = 28;

/** A payment period problem, or null. Days 1-28 (every month has them), start <= end (mirrors 0032's checks). */
export function periodProblem(startDay: number, endDay: number) {
  const ok = (d: number) => Number.isInteger(d) && d >= BILLING_DAY_MIN && d <= BILLING_DAY_MAX;
  if (!ok(startDay) || !ok(endDay)) return 'Payment days must be between 1 and 28.';
  if (startDay > endDay) return 'The first payment day must come before the last one.';
  return null;
}
