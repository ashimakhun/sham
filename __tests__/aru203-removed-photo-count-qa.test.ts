// ARU-203 QA re-test: the removed-photos note texts and the 0081 backfill. Server checks:
// supabase/tests/aru203_removed_photo_count_qa.test.sql (it runs the backfill statement checked here on pre-seeded rows).
import { pluralForm, translate } from '@/i18n';
import en from '@/i18n/en.json';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';

const fs = jest.requireActual<{ readFileSync: (file: string, encoding: 'utf8') => string }>('fs');
const migration = fs.readFileSync(`${process.cwd()}/supabase/migrations/0081_homework_photos.sql`, 'utf8');
const forms = ['one', 'few', 'many', 'other'] as const;

describe('ARU-203: 0081 backfill of homework.photos_removed_count', () => {
  const add = migration.indexOf('alter table homework add column photos_removed_count');
  const backfill = migration.indexOf('update homework set photos_removed_count = 1 where photo_removed_at is not null;');
  const trigger = migration.indexOf('create trigger homework_keep_photos_removed_count');

  it('adds the column (not null, default 0, never negative)', () => {
    expect(add).toBeGreaterThan(-1);
    expect(migration).toContain(
      'alter table homework add column photos_removed_count integer not null default 0 check (photos_removed_count >= 0);',
    );
  });

  it('sets 1 on every homework already removed, after adding the column and before the guard trigger', () => {
    expect(backfill).toBeGreaterThan(add);
    expect(trigger).toBeGreaterThan(backfill);
  });
});

describe('ARU-203: removed-photos texts', () => {
  it('the old singular text is unchanged in both languages', () => {
    expect(en['homework.photoRemoved']).toBe('Photo removed 6 months after checking');
    expect(ru['homework.photoRemoved']).toBe('Фото удалено через 6 месяцев после проверки');
  });

  it('the new plural key has every form in en, ru and notes', () => {
    for (const form of forms) {
      const id = `homework.photosRemoved_${form}`;
      expect((en as Record<string, string>)[id]).toContain('{count}');
      expect((ru as Record<string, string>)[id]).toContain('{count}');
      expect((notes as Record<string, string>)[id]).toBeTruthy();
    }
  });

  it.each([2, 3, 5, 10])('English, %i: plural "photos removed"', (count) => {
    expect(translate('en', 'homework.photosRemoved', { count })).toBe(`${count} photos removed 6 months after checking`);
  });

  it.each<[number, 'few' | 'many' | 'one']>([
    [2, 'few'],
    [3, 'few'],
    [4, 'few'],
    [5, 'many'],
    [6, 'many'],
    [10, 'many'],
    [11, 'many'],
    [12, 'many'],
    [14, 'many'],
    [21, 'one'],
    [22, 'few'],
    [25, 'many'],
  ])('Russian, %i uses the %s form of the catalog', (count, form) => {
    expect(pluralForm('ru', count)).toBe(form);
    const text = translate('ru', 'homework.photosRemoved', { count });
    expect(text).toBe((ru as Record<string, string>)[`homework.photosRemoved_${form}`].replace('{count}', String(count)));
  });

  it.each<[number, string]>([
    [2, '2 фото удалены через 6 месяцев после проверки'],
    [3, '3 фото удалены через 6 месяцев после проверки'],
    [4, '4 фото удалены через 6 месяцев после проверки'],
    [5, '5 фото удалены через 6 месяцев после проверки'],
    [7, '7 фото удалены через 6 месяцев после проверки'],
    [10, '10 фото удалены через 6 месяцев после проверки'],
  ])('Russian text for %i', (count, text) => {
    expect(translate('ru', 'homework.photosRemoved', { count })).toBe(text);
  });
});
