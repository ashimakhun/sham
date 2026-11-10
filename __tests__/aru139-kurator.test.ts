// ARU-139: in Russian the course owner is «Куратор» everywhere; English keeps «Owner». Only catalog texts change.
import en from '@/i18n/en.json';
import { translate } from '@/i18n';
import ru from '@/i18n/ru.json';

const RU = ru as Record<string, string>;
const EN = en as Record<string, string>;

describe('ARU-139: «Куратор» in the Russian catalog', () => {
  it('AC6: no «владелец» / «владеет» left in ru.json', () => {
    for (const [key, text] of Object.entries(RU)) expect(`${key}: ${text}`).not.toMatch(/[Вв]ладе/);
  });

  it('AC1/AC2: short labels and the change-owner screen', () => {
    expect(translate('ru', 'courses.ownerPrefix')).toBe('Куратор:');
    expect(translate('ru', 'homework.tabOwner')).toBe('Куратор');
    expect(translate('ru', 'courses.ownerLabel')).toBe('Куратор');
    expect(translate('ru', 'chat.owner')).toBe('Куратор');
    expect(translate('ru', 'courses.ownerA11y', { name: 'Анна' })).toBe('Куратор, Анна');
    expect(translate('ru', 'courses.changeOwner')).toBe('Сменить куратора');
    expect(translate('ru', 'courses.ownerIntro', { title: 'Алгебра' })).toBe(
      'Выберите нового куратора курса «Алгебра». Куратор сменится сразу после нажатия на имя.',
    );
  });

  it.each([
    [1, 'курса'],
    [2, 'курсов'],
    [5, 'курсов'],
    [21, 'курса'],
  ])('AC5: the Roles page warning for %i course(s)', (count, word) => {
    expect(translate('ru', 'roles.ownsCourses', { name: 'Анна', count, titles: 'Алгебра' })).toBe(
      `Анна — куратор ${count} ${word}: Алгебра. Сначала смените куратора`,
    );
  });

  it('AC7: English keeps «Owner» and the key sets match', () => {
    expect(translate('en', 'courses.ownerLabel')).toBe('Owner');
    expect(translate('en', 'chat.owner')).toBe('Owner');
    expect(Object.keys(RU).sort()).toEqual(Object.keys(EN).sort());
  });
});
