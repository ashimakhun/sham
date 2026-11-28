// ARU-203: after the 6-month deletion, Homework details says how many photos were removed. 1 photo (or a homework
// removed before the count was stored) keeps the old homework.photoRemoved text; 2 or more use homework.photosRemoved
// with the count and the Russian plural forms. Server side: supabase/tests/aru203_removed_photo_count.test.sql.
import { render, screen } from '@testing-library/react-native';

import HomeworkDetailScreen from '@/app/homework/[id]';
import { translate } from '@/i18n';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import type { User } from '@/lib/types';

import { fakeStore, hw, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const members = [member('A', 'S1')];

async function showRemoved(language: 'en' | 'ru', photosRemovedCount: number | undefined) {
  params.id = 'gone';
  const gone = hw({
    id: 'gone',
    courseId: 'A',
    status: 'checked',
    photos: [],
    photoRemovedAt: '2027-05-01T03:17:00Z',
    photosRemovedCount,
  });
  const me: User = { ...users.S1, language };
  setStore(fakeStore('S1', { currentUser: me, courseMembers: members, visibleHomework: [gone] }));
  await render(
    <LanguageProvider>
      <HomeworkDetailScreen />
    </LanguageProvider>,
  );
  expect(screen.getAllByTestId('homework-photo-removed')).toHaveLength(1);
  expect(screen.queryByTestId('homework-photo')).toBeNull();
}

describe('Homework details: the removed-photos note', () => {
  it.each<['en' | 'ru', number | undefined, string]>([
    ['en', 1, 'Photo removed 6 months after checking'],
    ['en', 3, '3 photos removed 6 months after checking'],
    ['en', 5, '5 photos removed 6 months after checking'],
    ['ru', 1, 'Фото удалено через 6 месяцев после проверки'],
    ['ru', 3, '3 фото удалены через 6 месяцев после проверки'],
    ['ru', 5, '5 фото удалены через 6 месяцев после проверки'],
    // Before 0081 runs (no column) or a 0 count: the old text.
    ['en', undefined, 'Photo removed 6 months after checking'],
    ['ru', 0, 'Фото удалено через 6 месяцев после проверки'],
  ])('%s, %p photo(s): "%s"', async (language, count, text) => {
    await showRemoved(language, count);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('the old singular text is unchanged', () => {
    expect(translate('en', 'homework.photoRemoved')).toBe('Photo removed 6 months after checking');
    expect(translate('ru', 'homework.photoRemoved')).toBe('Фото удалено через 6 месяцев после проверки');
  });

  it.each<[number, string]>([
    [2, '2 фото удалены через 6 месяцев после проверки'],
    [4, '4 фото удалены через 6 месяцев после проверки'],
    [10, '10 фото удалены через 6 месяцев после проверки'],
  ])('Russian plural for %i', (count, text) => {
    expect(translate('ru', 'homework.photosRemoved', { count })).toBe(text);
  });
});
