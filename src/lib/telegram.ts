// Telegram notifications (ARU-48): the bot's username and the switches shown per role.
import { currentLanguage, type Language, translate } from '@/i18n';

import type { Role, TelegramKind } from './types';

/** The bot's username from EXPO_PUBLIC_TELEGRAM_BOT_USERNAME (without "@"); empty means Telegram is off in the app. */
export function telegramBotUsername(): string {
  return (process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME ?? '').trim().replace(/^@/, '');
}

/** The link the Connect button opens: the Telegram app if installed, otherwise its web page. */
export function telegramStartUrl(username: string, code: string): string {
  return `https://t.me/${username}?start=${encodeURIComponent(code)}`;
}

export const TELEGRAM_SWITCHES: { kind: TelegramKind; label: string }[] = [
  { kind: 'meeting_started', label: 'Meeting started' },
  { kind: 'new_homework', label: 'New homework' },
  { kind: 'homework_reviewed', label: 'Homework reviewed' },
  // ARU-89: course owners (teacher and mentors) only; students can't own a course.
  { kind: 'homework_submitted', label: 'Homework submitted' },
  { kind: 'chat_message', label: 'Chat messages' },
  // ARU-87: every role, right below Chat messages.
  { kind: 'general_chat', label: 'General chat' },
  // ARU-102: every role, right below General chat (for the teacher, before New accounts).
  { kind: 'new_material', label: 'New materials' },
  // ARU-84: only the teacher accepts accounts, so only the teacher sees it (right after Chat messages).
  { kind: 'new_account', label: 'New accounts' },
];

/**
 * The teacher is never a listener and never sends homework: chat messages, the general chat (ARU-87), new materials
 * (ARU-102), homework submitted to courses they own (ARU-89) and new accounts (ARU-84). Mentors: everything but new
 * accounts. Students: also no homework submitted.
 */
const KINDS_FOR: Record<Role, TelegramKind[]> = {
  teacher: ['homework_submitted', 'chat_message', 'general_chat', 'new_material', 'new_account'],
  mentor: [
    'meeting_started',
    'new_homework',
    'homework_reviewed',
    'homework_submitted',
    'chat_message',
    'general_chat',
    'new_material',
  ],
  student: ['meeting_started', 'new_homework', 'homework_reviewed', 'chat_message', 'general_chat', 'new_material'],
};

/** ARU-113 AC 6: the switches a role sees, with their labels in the app's language. */
export function telegramSwitchesFor(role: Role, lang: Language = currentLanguage()) {
  return TELEGRAM_SWITCHES.filter((s) => KINDS_FOR[role].includes(s.kind)).map((s) => ({
    ...s,
    label: translate(lang, `telegram.switch.${s.kind}`),
  }));
}
