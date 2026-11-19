// ARU-87 AC 6: the General chat switch on the Notifications page (the Telegram card until ARU-166/ARU-171), right below Chat messages, for every role, on by default.
// The sending side is tested in supabase/functions/_shared/general-chat.test.ts and
// supabase/tests/aru87_every_chat_message.test.sql.
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

it.each(['teacher', 'mentor', 'student'] as const)('notificationSwitchesFor(%s): General chat right after Chat messages', (role) => {
  const labels = notificationSwitchesFor(role).map((s) => s.label);
  expect(labels[labels.indexOf('Chat messages') + 1]).toBe('General chat');
});

it('the teacher sees Chat messages, General chat and New accounts', () => {
  expect(notificationSwitchesFor('teacher').map((s) => s.label)).toEqual(
    expect.arrayContaining(['Chat messages', 'General chat', 'New accounts']),
  );
});

describe('the Notifications page', () => {
  it.each(['T', 'M', 'S1'] as const)('%s sees General chat below Chat messages, on by default', async (who) => {
    setStore(fakeStore(who, { notificationSettings: saved() }));
    await showPage();
    const labels = switches();
    expect(labels[labels.indexOf('Chat messages') + 1]).toBe('General chat');
    expect(screen.getByLabelText('General chat').props.value).toBe(true);
  });

  it('shows the saved value; turning it off saves kind general_chat and leaves Chat messages alone', async () => {
    const store = fakeStore('S1', { notificationSettings: saved({ general_chat: true }) });
    setStore(store);
    await showPage();
    await fireEvent(screen.getByLabelText('General chat'), 'valueChange', false);
    expect(store.setNotification).toHaveBeenCalledWith('general_chat', false);
    expect(store.setNotification).not.toHaveBeenCalledWith('chat_message', expect.anything());
  });

  it('a saved off value shows off', async () => {
    setStore(fakeStore('M', { notificationSettings: saved({ general_chat: false }) }));
    await showPage();
    expect(screen.getByLabelText('General chat').props.value).toBe(false);
    expect(screen.getByLabelText('Chat messages').props.value).toBe(true);
  });
});
