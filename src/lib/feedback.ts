import { currentLanguage, formatNumberIn, type Language, translate } from '@/i18n';

import type { CourseFeedback, Meeting } from './types';

/** Longest feedback text, after trimming (the database checks it too: 0025_course_feedback.sql). */
export const FEEDBACK_MAX = 1000;

/** ARU-53: a course has started once one of its meetings is completed (mirrors course_started() in 0025). */
export function courseStarted(meetings: Meeting[], courseId: string) {
  return meetings.some((m) => m.courseId === courseId && m.status === 'completed');
}

/** A course's feedback, newest first. */
export function feedbackFor(all: CourseFeedback[], courseId: string) {
  return all.filter((f) => f.courseId === courseId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// One decimal, with the language's decimal mark ("4.3" / "4,3").
const averageOf = (items: CourseFeedback[], lang: Language) => {
  const average = items.reduce((sum, f) => sum + f.rating, 0) / items.length;
  return lang === 'en' ? average.toFixed(1) : average.toFixed(1).replace('.', ',');
};

/** "★ 4.3 · 6 reviews" (one decimal), or undefined with no feedback. In the app's language (ARU-109). */
export function ratingSummary(items: CourseFeedback[], lang: Language = currentLanguage()) {
  if (!items.length) return undefined;
  return translate(lang, 'feedback.summary', { average: averageOf(items, lang), count: items.length, n: formatNumberIn(lang, items.length) });
}

/** Screen reader text for a summary: "Rated 4.3 out of 5, 6 reviews". */
export function ratingSummaryLabel(items: CourseFeedback[], lang: Language = currentLanguage()) {
  if (!items.length) return undefined;
  return translate(lang, 'feedback.summaryLabel', { average: averageOf(items, lang), count: items.length, n: formatNumberIn(lang, items.length) });
}

/** "★★★★☆" for 4 stars. */
export const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);
export const starsLabel = (rating: number, lang: Language = currentLanguage()) =>
  translate(lang, 'feedback.stars', { count: rating });

/** Edited after it was first saved (the database sets updatedAt only on edits). */
export const isEdited = (f: CourseFeedback) => f.updatedAt > f.createdAt;
