// ARU-89 AC 4: the Homework submitted switch on the Telegram card, for teachers and mentors (course owners), on by
// default; students never see it. The sending side is tested in supabase/functions/_shared/homework-submitted.test.ts
// and supabase/tests/aru89_homework_submitted_notifications.test.sql.
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

describe('telegramSwitchesFor', () => {
  it('teacher: Homework submitted, Chat messages, General chat (ARU-87), New accounts', () => {
    expect(telegramSwitchesFor('teacher').map((s) => s.kind)).toEqual([
      'homework_submitted',
      'chat_message',
      'general_chat',
      'new_account',
    ]);
  });

  it('mentor: every listener switch plus Homework submitted, never New accounts', () => {
    expect(telegramSwitchesFor('mentor').map((s) => s.label)).toEqual([
      'Meeting started',
      'New homework',
      'Homework reviewed',
      'Homework submitted',
      'Chat messages',
      'General chat',
    ]);
  });

  it('student: no Homework submitted', () => {
    expect(telegramSwitchesFor('student').map((s) => s.label)).toEqual([
      'Meeting started',
      'New homework',
      'Homework reviewed',
      'Chat messages',
      'General chat',
    ]);
  });
});

describe('the card', () => {
  it.each(['T', 'M'] as const)('%s sees Homework submitted, on by default', async (who) => {
    setStore(fakeStore(who, { telegram: linked() }));
    await render(<TelegramScreen />);
    expect(switches()).toContain('Homework submitted');
    expect(screen.getByLabelText('Homework submitted').props.value).toBe(true);
  });

  it('shows the saved value and saves kind homework_submitted', async () => {
    const store = fakeStore('M', { telegram: linked({ homework_submitted: false }) });
    setStore(store);
    await render(<TelegramScreen />);
    expect(screen.getByLabelText('Homework submitted').props.value).toBe(false);
    await fireEvent(screen.getByLabelText('Homework submitted'), 'valueChange', true);
    expect(store.setTelegramNotification).toHaveBeenCalledWith('homework_submitted', true);
  });

  it('a student never sees it', async () => {
    setStore(fakeStore('S1', { telegram: linked({ homework_submitted: true }) }));
    await render(<TelegramScreen />);
    expect(screen.queryByLabelText('Homework submitted')).toBeNull();
  });
});
