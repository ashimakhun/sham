// ARU-89 AC 4: the Homework submitted switch on the Notifications page (the Telegram card until ARU-166/ARU-171), for teachers and mentors (course owners), on by
// default; students never see it. The sending side is tested in supabase/functions/_shared/homework-submitted.test.ts
// and supabase/tests/aru89_homework_submitted_notifications.test.sql.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import NotificationsScreen from '@/app/notifications';
import { notificationSwitchesFor } from '@/lib/notifications';
import type { NotificationKind } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

// The account's saved switches (ARU-166's notification_settings); a kind not in it reads as on.
const saved = (over: Partial<Record<NotificationKind, boolean>> = {}) =>
  ({ meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true, ...over }) as Record<
    NotificationKind,
    boolean
  >;
async function showPage() {
  await render(<NotificationsScreen />);
  await act(async () => {});
}
const switches = () => screen.queryAllByRole('switch').map((s) => s.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('notificationSwitchesFor', () => {
  it('teacher: Homework submitted, Chat messages, General chat (ARU-87), New accounts', () => {
    expect(notificationSwitchesFor('teacher').map((s) => s.kind)).toEqual([
      'homework_submitted',
      'chat_message',
      'general_chat',
      'new_material',
      'meeting_notes',
      'new_account',
    ]);
  });

  it('mentor: every listener switch plus Homework submitted, never New accounts', () => {
    expect(notificationSwitchesFor('mentor').map((s) => s.label)).toEqual([
      'Meeting started',
      'New homework',
      'Homework reviewed',
      'Photo deletion',
      'Homework submitted',
      'Chat messages',
      'General chat',
      'New materials',
      'Meeting notes',
    ]);
  });

  it('student: no Homework submitted', () => {
    expect(notificationSwitchesFor('student').map((s) => s.label)).toEqual([
      'Meeting started',
      'New homework',
      'Homework reviewed',
      'Photo deletion',
      'Chat messages',
      'General chat',
      'New materials',
      'Meeting notes',
    ]);
  });
});

describe('the Notifications page', () => {
  it.each(['T', 'M'] as const)('%s sees Homework submitted, on by default', async (who) => {
    setStore(fakeStore(who, { notificationSettings: saved() }));
    await showPage();
    expect(switches()).toContain('Homework submitted');
    expect(screen.getByLabelText('Homework submitted').props.value).toBe(true);
  });

  it('shows the saved value and saves kind homework_submitted', async () => {
    const store = fakeStore('M', { notificationSettings: saved({ homework_submitted: false }) });
    setStore(store);
    await showPage();
    expect(screen.getByLabelText('Homework submitted').props.value).toBe(false);
    await fireEvent(screen.getByLabelText('Homework submitted'), 'valueChange', true);
    expect(store.setNotification).toHaveBeenCalledWith('homework_submitted', true);
  });

  it('a student never sees it', async () => {
    setStore(fakeStore('S1', { notificationSettings: saved({ homework_submitted: true }) }));
    await showPage();
    expect(screen.queryByLabelText('Homework submitted')).toBeNull();
  });
});
