// ARU-170: puts the reminders src/lib/reminders.ts computes on this phone (expo-notifications, date triggers on the
// General Android channel). Only notifications this app scheduled as reminders are ever cancelled: their identifier
// starts with REMINDER_PREFIX (and data.sham = 'reminder'); pushes and anything else are left alone.
// Every call is queued after the previous one, never throws and never shows anything (AC 1).
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { Platform } from 'react-native';

import { ANDROID_CHANNEL_ID, ensureChannel, reminderPermission } from './push';
import { REMINDER_PREFIX, type Reminder, reminderSignature } from './reminders';

/** Reminders work in an installed build and in Expo Go, on iOS and Android, not on the web. */
export const remindersSupported = () => Platform.OS === 'ios' || Platform.OS === 'android';

// The set last put on the phone (null: unknown, e.g. after a cancel or a failure, so the next sync schedules again).
let lastSignature: string | null = null;
// Bumped by cancelAllReminders(): a sync that started before a sign-out never schedules afterwards (AC 3).
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

const isOwn = (r: Notifications.NotificationRequest) =>
  r.identifier.startsWith(REMINDER_PREFIX) || (r.content?.data as { sham?: unknown } | undefined)?.sham === 'reminder';

async function cancelOwn() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter(isOwn).map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)));
}

export type ReminderState = {
  /** The account is Approved (a waiting or declined account gets none, AC 2). */
  approved: boolean;
  /** The reminders to have; undefined = unknown yet (switches not loaded): what's scheduled stays as it is. */
  reminders: Reminder[] | undefined;
};

/**
 * AC 1 / AC 2: reschedules. Can't remind (web, permission not granted, not Approved) → every reminder of this app is
 * cancelled. Otherwise, when the set changed since last time, cancel ours and schedule the new set. A failure keeps
 * nothing remembered, so the next load tries again.
 */
export function syncReminders(state: ReminderState): Promise<void> {
  if (!remindersSupported()) return Promise.resolve();
  const startedIn = generation;
  return enqueue(async () => {
    try {
      if (startedIn !== generation) return;
      const permission = await reminderPermission();
      if (startedIn !== generation) return;
      if (!state.approved || permission !== 'granted') {
        if (lastSignature !== '') {
          await cancelOwn();
          lastSignature = '';
        }
        return;
      }
      if (!state.reminders) return;
      const signature = reminderSignature(state.reminders);
      if (signature === lastSignature) return;
      lastSignature = null;
      await cancelOwn();
      if (startedIn !== generation) return;
      await ensureChannel();
      for (const r of state.reminders) {
        if (startedIn !== generation) return;
        await Notifications.scheduleNotificationAsync({
          identifier: r.id,
          content: { title: 'Sham', body: r.body, data: { sham: 'reminder' }, sound: 'default' },
          trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(r.fireAt), channelId: ANDROID_CHANNEL_ID },
        });
      }
      lastSignature = signature;
    } catch {
      lastSignature = null;
    }
  });
}

/**
 * AC 3: cancels every reminder of this app on this phone (sign-out, account deleted). Local only, so it works offline;
 * never throws. A sync still running stops before scheduling anything more.
 */
export function cancelAllReminders(): Promise<void> {
  if (!remindersSupported()) return Promise.resolve();
  generation += 1;
  return enqueue(async () => {
    try {
      await cancelOwn();
      lastSignature = '';
    } catch {
      lastSignature = null;
    }
  });
}

/** Tests only: forget what was scheduled. */
export function __resetReminderScheduler() {
  lastSignature = null;
  generation += 1;
  queue = Promise.resolve();
}
