// Telegram notifications (ARU-48): the bot's username and the switches shown per role.
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
  { kind: 'chat_message', label: 'Chat messages' },
  // ARU-84: only the teacher accepts accounts, so only the teacher sees it (right after Chat messages).
  { kind: 'new_account', label: 'New accounts' },
];

/** Kinds only the teacher gets. */
const TEACHER_ONLY: TelegramKind[] = ['new_account'];
/** Kinds the teacher gets: never a listener and never sends homework, so chat messages and new accounts (ARU-84). */
const TEACHER_KINDS: TelegramKind[] = ['chat_message', 'new_account'];

export function telegramSwitchesFor(role: Role) {
  return role === 'teacher'
    ? TELEGRAM_SWITCHES.filter((s) => TEACHER_KINDS.includes(s.kind))
    : TELEGRAM_SWITCHES.filter((s) => !TEACHER_ONLY.includes(s.kind));
}
