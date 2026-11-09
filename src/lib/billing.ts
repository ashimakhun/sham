import { currentLanguage, type Language, translate } from '@/i18n';

import { formatDate } from './theme';
import type { Course, CourseBilling, CourseMember, CoursePayment, PaymentExemption, PaymentRequest, User } from './types';

/** ARU-65: an approved mentor with Accountant on (mirrors is_accountant() in 0032). */
export function isAccountant(user: User | null | undefined) {
  return !!user && user.role === 'mentor' && !!user.isAccountant && (user.accessStatus ?? 'approved') === 'approved';
}

/** Who sees paid courses and changes their periods: accountants and the teacher. */
export function canSeeBilling(user: User | null | undefined) {
  return isAccountant(user) || user?.role === 'teacher';
}

/** "Pays 1–5 of each month" (one day: "Pays 5 of each month"). */
export function periodText(b: Pick<CourseBilling, 'startDay' | 'endDay'>, lang: Language = currentLanguage()) {
  const days = b.startDay === b.endDay ? `${b.startDay}` : `${b.startDay}–${b.endDay}`;
  return translate(lang, 'billing.period', { days });
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

// ARU-66: payments. "Today" and the month always come from the device's local date, never UTC.

const pad = (n: number) => String(n).padStart(2, '0');

/** The device-local date as YYYY-MM-DD. */
export function localDay(now: number | Date = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The first day of the device-local month as YYYY-MM-01 (the `month` of a Paid mark). */
export function localMonth(now: number | Date = Date.now()) {
  return `${localDay(now).slice(0, 8)}01`;
}

/** Whether the device-local day of `now` is within the payment period (inclusive). */
export function inPeriod(b: Pick<CourseBilling, 'startDay' | 'endDay'>, now: number | Date = Date.now()) {
  const day = new Date(now).getDate();
  return day >= b.startDay && day <= b.endDay;
}

/** A YYYY-MM-DD date shown like formatDate ("5 Nov 2026"), built from local parts so it never shifts a day. */
export function formatDay(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return formatDate(new Date(y, m - 1, d).toISOString());
}

/** "Payment due by 5 Nov 2026" (AC 7), in the app's language (ARU-109: shown on the Courses tab's card). */
export function paymentDueText(deadline: string, lang: Language = currentLanguage()) {
  return translate(lang, 'courses.paymentDueBy', { date: formatDay(deadline) });
}

export type PaymentStatus = { kind: 'exempt' } | { kind: 'paid'; payment: CoursePayment } | { kind: 'unpaid' };

/** A listener's state for a course and month. Exempt wins over a Paid mark (ANALYSIS note 2). */
export function paymentStatus(
  courseId: string,
  userId: string,
  month: string,
  payments: CoursePayment[],
  exemptions: PaymentExemption[],
): PaymentStatus {
  if (exemptions.some((e) => e.courseId === courseId && e.userId === userId)) return { kind: 'exempt' };
  const payment = payments.find((p) => p.courseId === courseId && p.userId === userId && p.month === month);
  return payment ? { kind: 'paid', payment } : { kind: 'unpaid' };
}

/** Current listeners of a course with their names, sorted by name. */
export function listenersOf(courseId: string, members: CourseMember[], getUser: (id: string) => User | undefined) {
  return members
    .filter((m) => m.courseId === courseId)
    .map((m) => ({ id: m.userId, name: getUser(m.userId)?.name ?? translate(currentLanguage(), 'common.unknown') }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export type UnpaidCourse = { courseId: string; title: string; names: string[] };

/**
 * AC 3: "Unpaid this month". null when no paid course is in its period today (the block isn't shown); otherwise the
 * courses in their period with unpaid listeners, sorted by title, each with the names sorted (empty: everyone paid).
 */
export function unpaidThisMonth(input: {
  billing: CourseBilling[];
  getCourse: (id: string) => Course | undefined;
  members: CourseMember[];
  getUser: (id: string) => User | undefined;
  payments: CoursePayment[];
  exemptions: PaymentExemption[];
  now: number | Date;
}): UnpaidCourse[] | null {
  const month = localMonth(input.now);
  const open = input.billing
    .map((b) => ({ b, course: input.getCourse(b.courseId) }))
    .filter((x): x is { b: CourseBilling; course: Course } => !!x.course && inPeriod(x.b, input.now));
  if (open.length === 0) return null;
  return open
    .map(({ course }) => ({
      courseId: course.id,
      title: course.title,
      names: listenersOf(course.id, input.members, input.getUser)
        .filter((l) => paymentStatus(course.id, l.id, month, input.payments, input.exemptions).kind === 'unpaid')
        .map((l) => l.name),
    }))
    .filter((c) => c.names.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title) || a.courseId.localeCompare(b.courseId));
}

/**
 * ARU-99 AC 6 / AC 9 / AC 10: payment requests still waiting for the accountant in `month`: the sender is a current
 * listener of the course and Unpaid (no Paid mark, not Exempt). Same helpers as "Unpaid this month", so the two can
 * never disagree. Requests of other months are never shown (AC 11).
 */
export function waitingRequests(input: {
  courseId: string;
  month: string;
  requests: PaymentRequest[];
  members: CourseMember[];
  payments: CoursePayment[];
  exemptions: PaymentExemption[];
}): PaymentRequest[] {
  return input.requests.filter(
    (r) =>
      r.courseId === input.courseId &&
      r.month === input.month &&
      input.members.some((m) => m.courseId === r.courseId && m.userId === r.userId) &&
      paymentStatus(r.courseId, r.userId, input.month, input.payments, input.exemptions).kind === 'unpaid',
  );
}

/**
 * ARU-124 AC 1: the payments page group of a listener: 0 unpaid with a waiting request, 1 unpaid, 2 paid, 3 exempt
 * (Exempt wins over Paid, as in paymentStatus).
 */
export function paymentRank(status: PaymentStatus, hasRequest: boolean) {
  if (status.kind === 'exempt') return 3;
  if (status.kind === 'paid') return 2;
  return hasRequest ? 0 : 1;
}

/** ARU-124 AC 1 / AC 5: listeners (already by name) ordered by paymentRank; sort() is stable, so A–Z stays. */
export function byPaymentRank<T extends { id: string }>(listeners: T[], rankOf: (id: string) => number): T[] {
  return [...listeners].sort((a, b) => rankOf(a.id) - rankOf(b.id));
}

/**
 * ARU-124 AC 2: keep a frozen order of ids. Listeners still present keep their place, gone ones are dropped and new
 * ones go at the end (in the order given).
 */
export function inFrozenOrder<T extends { id: string }>(listeners: T[], frozenIds: string[]): T[] {
  const byId = new Map(listeners.map((l) => [l.id, l]));
  const kept = frozenIds.flatMap((id) => {
    const l = byId.get(id);
    return l ? [l] : [];
  });
  const known = new Set(frozenIds);
  return [...kept, ...listeners.filter((l) => !known.has(l.id))];
}

/** "1 request" / "2 requests" (AC 6); "2 запроса" in Russian (ARU-113 AC 4). */
export function requestCountText(n: number, lang: Language = currentLanguage()) {
  return translate(lang, 'accountant.requestCount', { count: n });
}
