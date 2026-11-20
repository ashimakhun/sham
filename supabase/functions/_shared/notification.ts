// The notification message every Edge Function builds and sends as push (_shared/push.ts). Moved here from the old
// old sender file by ARU-171; the kinds, the message shape and the result counts are unchanged.
// No Deno-only imports, so Jest can test it.

export type NotificationKind = 'meeting_started' | 'chat_message' | 'homework_reviewed' | 'new_homework' | 'new_account'
  | 'homework_submitted'
  | 'general_chat'
  | 'new_material'
  | 'photo_deletion'
  | 'meeting_notes';

import type { NotificationLanguage } from './notification-texts.ts';

/**
 * `text` is the English text. ARU-110: a message built from the catalog also carries `texts` (every language), and
 * each recipient gets the one for their language; without it, `text` is sent.
 */
export type NotificationMessage = {
  userId: string;
  kind: NotificationKind;
  text: string;
  readonly texts?: Partial<Record<NotificationLanguage, string>>;
};

/**
 * ARU-110: a message in every language. `texts` is attached as a non-enumerable property, so the message still reads,
 * logs and compares as { userId, kind, text } (the English text); a copy without it is English.
 */
export function localizedMessage(
  userId: string,
  kind: NotificationKind,
  texts: Record<NotificationLanguage, string>,
): NotificationMessage {
  const message: NotificationMessage = { userId, kind, text: texts.en };
  Object.defineProperty(message, 'texts', { value: texts, enumerable: false });
  return message;
}

export type SendResult = {
  /** Messages accepted by at least one of the recipient's phones. */
  sent: number;
  /** Messages not sent because the recipient has that kind turned off or no phone registered. */
  skipped: number;
  /** Messages that still failed after the retries of this call (never retried by a later call). */
  failed: { userId: string; error: string }[];
  /** Phone registrations deleted because the push service said the device is no longer registered. */
  removed: number;
};

/** Which notification_settings column turns each kind on or off. */
export const SWITCH_COLUMN: Record<NotificationKind, string> = {
  meeting_started: 'notify_meeting_started',
  new_homework: 'notify_new_homework',
  homework_reviewed: 'notify_homework_reviewed',
  chat_message: 'notify_chat_message',
  new_account: 'notify_new_account',
  homework_submitted: 'notify_homework_submitted',
  general_chat: 'notify_general_chat',
  new_material: 'notify_new_material',
  photo_deletion: 'notify_photo_deletion',
  meeting_notes: 'notify_meeting_notes',
};
