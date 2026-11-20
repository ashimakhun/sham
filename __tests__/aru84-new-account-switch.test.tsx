// ARU-84 AC 3: the teacher's New accounts switch on the Notifications page (the Telegram card until ARU-166/ARU-171) (right after Chat messages, on by default);
// mentors and students never see it. The sending side is tested in supabase/functions/_shared/new-account.test.ts and
// supabase/tests/aru84_new_account_notifications.test.sql.
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
  it('teacher: New accounts next to the chat switches (Chat messages, then General chat since ARU-87)', () => {
    const labels = notificationSwitchesFor('teacher').map((s) => s.label);
    expect(labels.slice(labels.indexOf('Chat messages'))).toEqual(['Chat messages', 'General chat', 'New materials', 'Meeting notes', 'New accounts']);
  });

  it.each(['mentor', 'student'] as const)('%s: never New accounts', (role) => {
    const labels = notificationSwitchesFor(role).map((s) => s.label);
    expect(labels).not.toContain('New accounts');
    expect(labels).toContain('Chat messages');
  });
});

describe('the Notifications page', () => {
  it('the teacher sees New accounts after the chat switches, on by default (no saved value yet)', async () => {
    setStore(fakeStore('T', { notificationSettings: saved() }));
    await showPage();
    const labels = switches();
    expect(labels.slice(labels.indexOf('Chat messages'))).toEqual(['Chat messages', 'General chat', 'New materials', 'Meeting notes', 'New accounts']);
    expect(screen.getByLabelText('New accounts').props.value).toBe(true);
  });

  it('shows the saved value', async () => {
    setStore(fakeStore('T', { notificationSettings: saved({ new_account: false }) }));
    await showPage();
    expect(screen.getByLabelText('New accounts').props.value).toBe(false);
  });

  it('turning it off saves kind new_account', async () => {
    const store = fakeStore('T', { notificationSettings: saved({ new_account: true }) });
    setStore(store);
    await showPage();
    await fireEvent(screen.getByLabelText('New accounts'), 'valueChange', false);
    expect(store.setNotification).toHaveBeenCalledWith('new_account', false);
  });

  it.each(['M', 'S1'] as const)('%s never sees New accounts', async (who) => {
    setStore(fakeStore(who, { notificationSettings: saved({ new_account: true }) }));
    await showPage();
    expect(switches()).not.toContain('New accounts');
    expect(screen.queryByLabelText('New accounts')).toBeNull();
  });
});
