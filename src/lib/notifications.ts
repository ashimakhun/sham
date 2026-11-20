// The notification switches shown per role on the Notifications page (ARU-166), in order. They were the Telegram
// switches (ARU-48) until ARU-171 removed Telegram; the kinds, order and labels are unchanged.
import { currentLanguage, type Language, translate } from '@/i18n';

import type { NotificationKind, Role } from './types';

export const NOTIFICATION_SWITCHES: { kind: NotificationKind; label: string }[] = [
  { kind: 'meeting_started', label: 'Meeting started' },
  { kind: 'new_homework', label: 'New homework' },
  { kind: 'homework_reviewed', label: 'Homework reviewed' },
  // ARU-112: students and mentors (the senders of homework), right after Homework reviewed.
  { kind: 'photo_deletion', label: 'Photo deletion' },
  // ARU-89: course owners (teacher and mentors) only; students can't own a course.
  { kind: 'homework_submitted', label: 'Homework submitted' },
  { kind: 'chat_message', label: 'Chat messages' },
  // ARU-87: every role, right below Chat messages.
  { kind: 'general_chat', label: 'General chat' },
  // ARU-102: every role, right below General chat (for the teacher, before New accounts).
  { kind: 'new_material', label: 'New materials' },
  // ARU-151: every role, right below New materials (for the teacher, before New accounts).
  { kind: 'meeting_notes', label: 'Meeting notes' },
  // ARU-84: only the teacher accepts accounts, so only the teacher sees it (right after Chat messages).
  { kind: 'new_account', label: 'New accounts' },
];

/**
 * The teacher is never a listener and never sends homework: chat messages, the general chat (ARU-87), new materials
 * (ARU-102), meeting notes (ARU-151), homework submitted to courses they own (ARU-89) and new accounts (ARU-84). Mentors: everything but new
 * accounts. Students: also no homework submitted.
 */
const KINDS_FOR: Record<Role, NotificationKind[]> = {
  teacher: ['homework_submitted', 'chat_message', 'general_chat', 'new_material', 'meeting_notes', 'new_account'],
  mentor: [
    'meeting_started',
    'new_homework',
    'homework_reviewed',
    'photo_deletion',
    'homework_submitted',
    'chat_message',
    'general_chat',
    'new_material',
    'meeting_notes',
  ],
  student: [
    'meeting_started',
    'new_homework',
    'homework_reviewed',
    'photo_deletion',
    'chat_message',
    'general_chat',
    'new_material',
    'meeting_notes',
  ],
};

/** ARU-113 AC 6: the switches a role sees, with their labels in the app's language. */
export function notificationSwitchesFor(role: Role, lang: Language = currentLanguage()) {
  return NOTIFICATION_SWITCHES.filter((s) => KINDS_FOR[role].includes(s.kind)).map((s) => ({
    ...s,
    label: translate(lang, `notifications.switch.${s.kind}`),
  }));
}
