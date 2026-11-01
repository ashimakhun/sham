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

/** "★ 4.3 · 6 reviews" (one decimal), or undefined with no feedback. */
export function ratingSummary(items: CourseFeedback[]) {
  if (!items.length) return undefined;
  const average = items.reduce((sum, f) => sum + f.rating, 0) / items.length;
  return `★ ${average.toFixed(1)} · ${items.length} ${items.length === 1 ? 'review' : 'reviews'}`;
}

/** Screen reader text for a summary: "Rated 4.3 out of 5, 6 reviews". */
export function ratingSummaryLabel(items: CourseFeedback[]) {
  if (!items.length) return undefined;
  const average = items.reduce((sum, f) => sum + f.rating, 0) / items.length;
  return `Rated ${average.toFixed(1)} out of 5, ${items.length} ${items.length === 1 ? 'review' : 'reviews'}`;
}

/** "★★★★☆" for 4 stars. */
export const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);
export const starsLabel = (rating: number) => `${rating} ${rating === 1 ? 'star' : 'stars'}`;

/** Edited after it was first saved (the database sets updatedAt only on edits). */
export const isEdited = (f: CourseFeedback) => f.updatedAt > f.createdAt;
