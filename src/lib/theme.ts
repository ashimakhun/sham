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

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
