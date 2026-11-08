// ARU-112: the app side of the daily photo deletion: the Photo deletion switch (AC 5) and the note shown in place of a
// removed photo (AC 6). The job itself is tested in supabase/functions/_shared/photo-deletion.test.ts and
// supabase/tests/aru112_photo_deletion.test.sql.
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkDetailScreen from '@/app/homework/[id]';
import TelegramScreen from '@/app/telegram';
import { HomeworkCard } from '@/components/HomeworkCard';
import { PHOTO_REMOVED } from '@/lib/photoRetention';
import { telegramSwitchesFor } from '@/lib/telegram';
import type { TelegramLink } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const linked = (over: Partial<TelegramLink['switches']> = {}): TelegramLink => ({
  linkedAt: '2026-11-01T10:00:00.000Z',
  switches: { meeting_started: true, new_homework: true, homework_reviewed: true, chat_message: true, ...over },
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = 'ShamSchoolBot';
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

describe('AC 5: the Photo deletion switch', () => {
  it.each(['student', 'mentor'] as const)('%s has it right after Homework reviewed', (role) => {
    const labels = telegramSwitchesFor(role).map((s) => s.label);
    expect(labels[labels.indexOf('Homework reviewed') + 1]).toBe('Photo deletion');
  });

  it('the teacher does not have it', () => {
    expect(telegramSwitchesFor('teacher').map((s) => s.kind)).not.toContain('photo_deletion');
  });

  it('is on for an existing link that never set it, and turning it off saves only that kind', async () => {
    const store = fakeStore('S1', { telegram: linked() });
    setStore(store);
    await render(<TelegramScreen />);
    const sw = screen.getByRole('switch', { name: 'Photo deletion' });
    expect(sw.props.value).toBe(true);
    await fireEvent(sw, 'valueChange', false);
    expect(store.setTelegramNotification).toHaveBeenCalledWith('photo_deletion', false);
    expect(store.setTelegramNotification).toHaveBeenCalledTimes(1);
  });

  it('shows a saved off as off', async () => {
    setStore(fakeStore('M', { telegram: linked({ photo_deletion: false }) }));
    await render(<TelegramScreen />);
    expect(screen.getByRole('switch', { name: 'Photo deletion' }).props.value).toBe(false);
  });
});

describe('AC 6: after removal', () => {
  const removed = hw({
    id: 'h1',
    courseId: 'A',
    studentId: 'S1',
    status: 'checked',
    checkedById: 'M',
    checkedAt: '2026-04-01T10:00:00.000Z',
    photoRemovedAt: '2026-10-01T03:17:00.000Z',
    title: 'Old essay',
  });

  it.each(['S1', 'M', 'T'] as const)('%s sees the note instead of the photo, with no preview to open', async (who) => {
    params.id = 'h1';
    setStore(fakeStore(who, { courseMembers: [member('A', 'S1')], visibleHomework: [removed] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getByTestId('homework-photo-removed')).toBeTruthy();
    expect(screen.getByText(PHOTO_REMOVED)).toBeTruthy();
    expect(PHOTO_REMOVED).toBe('Photo removed 6 months after checking');
    expect(screen.queryByTestId('homework-photo')).toBeNull();
    expect(screen.queryByRole('imagebutton', { name: 'Open photo' })).toBeNull();
    expect(screen.queryByText('Photo unavailable')).toBeNull();
    // The rest of the homework stays.
    expect(screen.getByText('Old essay')).toBeTruthy();
  });

  it('a stored photo shows as before, without the note', async () => {
    params.id = 'h2';
    const stored = hw({ id: 'h2', courseId: 'A', studentId: 'S1', photoPath: 'S1/h2.jpg', photoUrl: 'https://x/h2.jpg' });
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], visibleHomework: [stored] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getByTestId('homework-photo')).toBeTruthy();
    expect(screen.queryByTestId('homework-photo-removed')).toBeNull();
  });

  it('a broken link still shows "Photo unavailable" (regression), not the removed note', async () => {
    params.id = 'h3';
    const broken = hw({ id: 'h3', courseId: 'A', studentId: 'S1', photoPath: 'S1/h3.jpg' });
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], visibleHomework: [broken] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getByText('Photo unavailable')).toBeTruthy();
    expect(screen.queryByTestId('homework-photo-removed')).toBeNull();
  });

  it('the card has no "📎 photo" marker', async () => {
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')], visibleHomework: [removed] }));
    await render(<HomeworkCard item={removed} />);
    expect(screen.queryByText(/📎 photo/)).toBeNull();
  });
});

describe('ARU-133: in Russian', () => {
  it('the switch and the removed-photo note come from the catalog', async () => {
    const { telegramSwitchesFor: forRole } = jest.requireActual('@/lib/telegram') as typeof import('@/lib/telegram');
    expect(forRole('student', 'ru').find((s) => s.kind === 'photo_deletion')?.label).toBe('Удаление фото');
    expect(forRole('student', 'en').find((s) => s.kind === 'photo_deletion')?.label).toBe('Photo deletion');
    const { translate } = jest.requireActual('@/i18n') as typeof import('@/i18n');
    expect(translate('ru', 'homework.photoRemoved')).toBe('Фото удалено через 6 месяцев после проверки');
    expect(translate('en', 'homework.photoRemoved')).toBe(PHOTO_REMOVED);
  });
});
