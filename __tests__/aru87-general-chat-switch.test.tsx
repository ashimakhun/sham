// ARU-87 AC 6: the General chat switch on the Telegram card, right below Chat messages, for every role, on by default.
// The sending side is tested in supabase/functions/_shared/general-chat.test.ts and
// supabase/tests/aru87_every_chat_message.test.sql.
import { fireEvent, render, screen } from '@testing-library/react-native';

import TelegramScreen from '@/app/telegram';
import { telegramSwitchesFor } from '@/lib/telegram';
import type { TelegramLink } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const linked = (over: Partial<TelegramLink['switches']> = {}): TelegramLink => ({
  linkedAt: '2026-11-01T10:00:00.000Z',
  switches: { meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true, ...over },
});
const switches = () => screen.queryAllByRole('switch').map((s) => s.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

it.each(['teacher', 'mentor', 'student'] as const)('telegramSwitchesFor(%s): General chat right after Chat messages', (role) => {
  const labels = telegramSwitchesFor(role).map((s) => s.label);
  expect(labels[labels.indexOf('Chat messages') + 1]).toBe('General chat');
});

it('the teacher sees Chat messages, General chat and New accounts', () => {
  expect(telegramSwitchesFor('teacher').map((s) => s.label)).toEqual(
    expect.arrayContaining(['Chat messages', 'General chat', 'New accounts']),
  );
});

describe('the card', () => {
  it.each(['T', 'M', 'S1'] as const)('%s sees General chat below Chat messages, on by default', async (who) => {
    setStore(fakeStore(who, { telegram: linked() }));
    await render(<TelegramScreen />);
    const labels = switches();
    expect(labels[labels.indexOf('Chat messages') + 1]).toBe('General chat');
    expect(screen.getByLabelText('General chat').props.value).toBe(true);
  });

  it('shows the saved value; turning it off saves kind general_chat and leaves Chat messages alone', async () => {
    const store = fakeStore('S1', { telegram: linked({ general_chat: true }) });
    setStore(store);
    await render(<TelegramScreen />);
    await fireEvent(screen.getByLabelText('General chat'), 'valueChange', false);
    expect(store.setTelegramNotification).toHaveBeenCalledWith('general_chat', false);
    expect(store.setTelegramNotification).not.toHaveBeenCalledWith('chat_message', expect.anything());
  });

  it('a saved off value shows off', async () => {
    setStore(fakeStore('M', { telegram: linked({ general_chat: false }) }));
    await render(<TelegramScreen />);
    expect(screen.getByLabelText('General chat').props.value).toBe(false);
    expect(screen.getByLabelText('Chat messages').props.value).toBe(true);
  });
});
