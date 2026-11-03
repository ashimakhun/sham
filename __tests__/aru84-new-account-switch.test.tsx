// ARU-84 AC 3: the teacher's New accounts switch on the Telegram card (right after Chat messages, on by default);
// mentors and students never see it. The sending side is tested in supabase/functions/_shared/new-account.test.ts and
// supabase/tests/aru84_new_account_notifications.test.sql.
import { fireEvent, render, screen } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
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
  it('teacher: Chat messages and New accounts, in that order', () => {
    expect(telegramSwitchesFor('teacher').map((s) => s.label)).toEqual(['Chat messages', 'New accounts']);
    expect(telegramSwitchesFor('teacher').map((s) => s.kind)).toEqual(['chat_message', 'new_account']);
  });

  it.each(['mentor', 'student'] as const)('%s: never New accounts', (role) => {
    const labels = telegramSwitchesFor(role).map((s) => s.label);
    expect(labels).not.toContain('New accounts');
    expect(labels).toEqual(['Meeting started', 'New homework', 'Homework reviewed', 'Chat messages']);
  });
});

describe('the card', () => {
  it('the teacher sees New accounts after Chat messages, on by default (no saved value yet)', async () => {
    setStore(fakeStore('T', { telegram: linked() }));
    await render(<ProfileScreen />);
    expect(switches()).toEqual(['Chat messages', 'New accounts']);
    expect(screen.getByLabelText('New accounts').props.value).toBe(true);
  });

  it('shows the saved value', async () => {
    setStore(fakeStore('T', { telegram: linked({ new_account: false }) }));
    await render(<ProfileScreen />);
    expect(screen.getByLabelText('New accounts').props.value).toBe(false);
  });

  it('turning it off saves kind new_account', async () => {
    const store = fakeStore('T', { telegram: linked({ new_account: true }) });
    setStore(store);
    await render(<ProfileScreen />);
    await fireEvent(screen.getByLabelText('New accounts'), 'valueChange', false);
    expect(store.setTelegramNotification).toHaveBeenCalledWith('new_account', false);
  });

  it.each(['M', 'S1'] as const)('%s never sees New accounts', async (who) => {
    setStore(fakeStore(who, { telegram: linked({ new_account: true }) }));
    await render(<ProfileScreen />);
    expect(switches()).not.toContain('New accounts');
    expect(screen.queryByLabelText('New accounts')).toBeNull();
  });
});
