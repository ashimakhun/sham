import { currentLanguage, formatDateIn, formatDateTimeIn } from '@/i18n';

import type { Role } from './types';

export const colors = {
  bg: '#F6F7FB',
  card: '#FFFFFF',
  text: '#1B1E28',
  muted: '#6B7280',
  border: '#E5E7EB',
  primary: '#4F46E5',
  primarySoft: '#EEF2FF',
  success: '#059669',
  successSoft: '#ECFDF5',
  warning: '#B45309',
  warningSoft: '#FFFBEB',
  danger: '#DC2626',
};

export const roleLabel: Record<Role, string> = {
  teacher: 'Teacher',
  mentor: 'Mentor',
  student: 'Student',
};

export const roleColor: Record<Role, string> = {
  teacher: '#7C3AED',
  mentor: '#0891B2',
  student: '#4F46E5',
};

/** A date in the app's language (ARU-109 AC 5): "12 May 2026" / "12 мая 2026", whatever the phone's locale. */
export function formatDate(iso: string) {
  return formatDateIn(currentLanguage(), iso);
}

/** Date and time (device time zone), e.g. for chat messages where several share a day: "12 May 2026, 14:05". */
export function formatDateTime(iso: string) {
  return formatDateTimeIn(currentLanguage(), iso);
}
