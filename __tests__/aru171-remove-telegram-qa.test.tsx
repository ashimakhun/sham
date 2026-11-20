// ARU-171 QA: Telegram removed completely. Gaps the dev tests don't cover: `sham://telegram` on the real route tree
// (AC 6), no Telegram identifiers left in the app (AC 6), the catalogs (AC 7), the Delete account text in Russian on
// screen (AC 8), the server files and imports (AC 4), and the README / .env.example (AC 9).
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { DeleteAccountForm } from '@/components/DeleteAccountForm';
import en from '@/i18n/en.json';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { DELETE_EXPLANATION_BEFORE } from '@/lib/deleteAccount';
import type { User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Paths are relative to the repo root (Jest's working directory), as in aru74-migration-numbers-qa.test.ts.
type Entry = { name: string; isDirectory: () => boolean };
const fs = jest.requireActual<{
  readFileSync: (file: string, encoding: 'utf8') => string;
  readdirSync: (dir: string, options: { withFileTypes: true }) => Entry[];
  existsSync: (file: string) => boolean;
}>('fs');
const read = (p: string) => fs.readFileSync(p, 'utf8');
const exists = (p: string) => fs.existsSync(p);
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: Entry) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);

describe('AC 6: the telegram route is gone', () => {
  it('no file under src/app is a telegram route', () => {
    expect(walk('src/app').filter((f) => /telegram/i.test(f))).toEqual([]);
    expect(read('src/app/_layout.tsx')).not.toMatch(/telegram/i);
  });

  it('sham://telegram opens the unmatched-route screen on the real route tree (screens stubbed)', async () => {
    const { renderRouter } = require('expo-router/testing-library');
    // Every real route file, with a stub screen; layouts become plain Slots so no store or header is needed.
    const { Slot } = require('expo-router');
    const tree: Record<string, unknown> = {};
    for (const f of walk('src/app')) {
      const route = f.replace(/^src\/app\//, '').replace(/\.tsx?$/, '');
      tree[route] = route.endsWith('_layout') ? () => <Slot /> : () => <Text>{`route:${route}`}</Text>;
    }
    expect(Object.keys(tree)).toContain('notifications');
    await renderRouter(tree, { initialUrl: '/telegram' });
    await act(async () => {});
    expect(screen.queryByText(/route:/)).toBeNull();
    expect(screen.getByText(/Unmatched Route/i)).toBeTruthy();
  });

  it('control: the same tree opens /notifications (ARU-166 page is kept)', async () => {
    const { renderRouter } = require('expo-router/testing-library');
    const { Slot } = require('expo-router');
    const tree: Record<string, unknown> = {};
    for (const f of walk('src/app')) {
      const route = f.replace(/^src\/app\//, '').replace(/\.tsx?$/, '');
      tree[route] = route.endsWith('_layout') ? () => <Slot /> : () => <Text>{`route:${route}`}</Text>;
    }
    await renderRouter(tree, { initialUrl: '/notifications' });
    await act(async () => {});
    expect(screen.getByText('route:notifications')).toBeTruthy();
  });

  it('no Telegram store members, types, lib or component are left in src', () => {
    expect(exists('src/components/Telegram.tsx')).toBe(false);
    expect(exists('src/lib/telegram.ts')).toBe(false);
    const names = /\b(telegram|loadTelegram|createTelegramLinkCode|setTelegramNotification|disconnectTelegram|setTelegram|TelegramKind|TelegramLink)\b/;
    const hits = walk('src').filter((f) => /\.(ts|tsx)$/.test(f))
      .flatMap((f) => read(f).split('\n').map((l: string, i: number) => [f, i + 1, l] as const))
      .filter(([, , l]) => names.test(l) && !/^\s*(\/\/|\*|\{\/\*)/.test(l));
    expect(hits).toEqual([]);
  });
});

describe('AC 7: catalogs', () => {
  const catalogs = { en, ru, notes } as Record<string, Record<string, string>>;
  it.each(Object.keys(catalogs))('%s has no telegram.* text but keeps db.telegram_not_accepted unchanged', (name) => {
    const c = catalogs[name];
    expect(Object.keys(c).filter((k) => k.startsWith('telegram.'))).toEqual([]);
    expect(c['db.telegram_not_accepted']).toBe({
      en: 'Only accepted accounts can connect Telegram.',
      ru: 'Подключить Telegram могут только подтверждённые аккаунты.',
      notes: 'Telegram notifications · an account still waiting',
    }[name]);
  });

  it('the three catalogs still have the same keys', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(notes).sort()).toEqual(Object.keys(en).sort());
  });

  it('telegram.linkFailed is gone from src/i18n/index.ts', () => {
    expect(read('src/i18n/index.ts')).not.toMatch(/telegram/i);
  });
});

describe('AC 8: Delete account explanation', () => {
  const EN = 'Your profile, homework and photos, course memberships, attendance marks, feedback, likes, materials and PDFs you shared, and your notification settings are deleted. Your chat messages and the work you did for others (checked homework, meetings, notes) stay, shown as ';
  const RU = 'Будут удалены Ваш профиль, домашние задания и фото, участие в курсах, отметки посещаемости, отзывы, лайки, материалы и PDF, которыми Вы поделились, и настройки уведомлений. Ваши сообщения в чатах и работа, которую Вы сделали для других (проверенные домашние задания, встречи, заметки), останутся и будут подписаны «';

  it('catalog texts and DELETE_EXPLANATION_BEFORE are exactly the story\'s wording', () => {
    expect(en['deleteAccount.explanationBefore']).toBe(EN);
    expect(ru['deleteAccount.explanationBefore']).toBe(RU);
    expect(DELETE_EXPLANATION_BEFORE).toBe(EN);
  });

  it.each(['S1', 'M'] as const)('%s in Russian sees the new text on screen, with no Telegram', async (who) => {
    const me: User = { ...users[who], language: 'ru' };
    setStore(fakeStore(who, { currentUser: me }));
    await render(<LanguageProvider><DeleteAccountForm onCancel={() => {}} /></LanguageProvider>);
    await act(async () => {});
    const all = JSON.stringify(screen.toJSON());
    expect(all).toContain('и настройки уведомлений. Ваши сообщения в чатах');
    expect(all).not.toMatch(/telegram|телеграм/i);
  });

  it('S1 in English sees the new text on screen, with no Telegram', async () => {
    const me: User = { ...users.S1, language: 'en' };
    setStore(fakeStore('S1', { currentUser: me }));
    await render(<LanguageProvider><DeleteAccountForm onCancel={() => {}} /></LanguageProvider>);
    await act(async () => {});
    const all = JSON.stringify(screen.toJSON());
    expect(all).toContain('and your notification settings are deleted.');
    expect(all).not.toMatch(/telegram/i);
  });
});

describe('AC 4: server code', () => {
  const fnFiles = walk('supabase/functions').filter((f) => /\.ts$/.test(f));
  const sources = fnFiles.filter((f) => !/\.test\.ts$|test-helpers/.test(f));

  it('the webhook and the Telegram sender files are deleted; no function file is named after Telegram', () => {
    expect(exists('supabase/functions/telegram-webhook')).toBe(false);
    expect(fnFiles.filter((f) => /telegram/i.test(f))).toEqual([]);
  });

  it('no Edge Function source reads TELEGRAM_* or calls api.telegram.org, or imports a Telegram file', () => {
    const bad = sources.filter((f) => /TELEGRAM_|api\.telegram\.org|from '[^']*telegram[^']*'/i.test(read(f)));
    expect(bad).toEqual([]);
  });

  it('the kept helpers live in neutral files', () => {
    expect(read('supabase/functions/_shared/timing-safe-equal.ts')).toMatch(/export function timingSafeEqual/);
    expect(read('supabase/functions/_shared/notification-texts.ts')).toMatch(/export function recipientLanguage/);
    expect(read('supabase/functions/_shared/notification-texts.ts')).toMatch(/export const NOTIFICATION_TEXTS/);
  });

  it.each([
    'chat-message-notifications', 'homework-reviewed-notifications', 'homework-submitted-notifications',
    'meeting-notes-notifications', 'new-account-notifications',
    'new-homework-notifications', 'new-material-notifications',
    // ARU-170: meeting-start-notifications is deleted and photo-deletion sends nothing (local reminders instead).
  ])('AC 5: %s still sends through the push sender', (fn) => {
    const src = read(`supabase/functions/${fn}/index.ts`);
    expect(src).toMatch(/from '\.\.\/_shared\/push\.ts'/);
    expect(src).toMatch(/sendPushMessages\(/);
  });
});

describe('AC 9: docs and config', () => {
  it('.env.example has no Telegram setting', () => {
    expect(read('.env.example')).not.toMatch(/TELEGRAM/i);
  });

  const readme = read('README.md');
  it('README: the only Telegram heading is "Removing the Telegram bot", and the access table has no Telegram row', () => {
    expect(readme.split('\n').filter((l: string) => /^#/.test(l) && /telegram/i.test(l))).toEqual(['### Removing the Telegram bot (ARU-171)']);
    expect(readme.split('\n').filter((l: string) => /^\|/.test(l) && /telegram/i.test(l))).toEqual([]);
  });

  it('README: Setup lists 0071 and the removal steps are there', () => {
    expect(readme).toContain('`0071_remove_telegram.sql`');
    const section = readme.split('### Removing the Telegram bot (ARU-171)')[1].split('\n### ')[0];
    for (const step of ['deleteWebhook', 'functions delete telegram-webhook', 'TELEGRAM_BOT_TOKEN',
      'EXPO_PUBLIC_TELEGRAM_BOT_USERNAME', '/deletebot']) expect(section).toContain(step);
    expect(section).toMatch(/old (app )?builds/i);
  });

  it('README: no link points to the removed Telegram notifications section', () => {
    expect(readme).not.toMatch(/\(#telegram-notifications/);
    expect(readme).not.toMatch(/\[Telegram notifications\]/);
  });
});
