import type { TextId } from '@/i18n';

import type { ContentKind, ContentReport, ReportReason } from './types';

/** ARU-158 AC 2: a report's comment, at most 500 characters (also checked by report_content(), 0064). */
export const REPORT_COMMENT_MAX = 500;

/** The four reasons, in the order the Report screen lists them. */
export const REPORT_REASONS: { value: ReportReason; label: TextId }[] = [
  { value: 'offensive', label: 'report.reason.offensive' },
  { value: 'spam', label: 'report.reason.spam' },
  { value: 'harassment', label: 'report.reason.harassment' },
  { value: 'other', label: 'report.reason.other' },
];

export const CONTENT_KINDS: ContentKind[] = ['course_message', 'general_message', 'meeting_note', 'blog_post', 'pdf', 'review'];

export const isContentKind = (value: unknown): value is ContentKind => CONTENT_KINDS.includes(value as ContentKind);

/** ARU-158 AC 6: open reports oldest first, then resolved ones newest first (by when they were resolved). */
export function sortReports(reports: ContentReport[]) {
  const open = reports.filter((r) => r.status === 'open').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const resolved = reports
    .filter((r) => r.status !== 'open')
    .sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt) || b.id.localeCompare(a.id));
  return { open, resolved };
}
