// ARU-132: after merging the Russian version, ARU-120's like heart reads its label and count from the EN/RU catalog,
// and the Blog card and post page keep main's translated texts.
import { render, screen } from '@testing-library/react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import { likeTexts } from '@/components/LikeHeart';
import { I18nContext, make } from '@/i18n/context';
import type { Material, MaterialLike } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const A: Material = { id: 'A', teacherId: 'T', title: 'Пост', body: 'x', link: 'https://x.y', createdAt: '2026-10-20T10:00:00.000Z' };
const like = (userId: string, minute: number): MaterialLike => ({
  materialId: 'A',
  userId,
  createdAt: `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`,
});
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;

describe('likeTexts', () => {
  it.each([
    [1, 'Поставить лайк, 1 лайк'],
    [2, 'Поставить лайк, 2 лайка'],
    [5, 'Поставить лайк, 5 лайков'],
    [11, 'Поставить лайк, 11 лайков'],
    [21, 'Поставить лайк, 21 лайк'],
  ])('Russian plural for %i', (n, text) => {
    expect(likeTexts.label(false, n, 'ru')).toBe(text);
  });

  it('Russian: Like at 0, Unlike when liked', () => {
    expect(likeTexts.label(false, 0, 'ru')).toBe('Поставить лайк');
    expect(likeTexts.label(true, 3, 'ru')).toBe('Убрать лайк, 3 лайка');
  });

  it('English is unchanged (AC 11)', () => {
    expect(likeTexts.label(false, 0)).toBe('Like');
    expect(likeTexts.label(false, 1)).toBe('Like, 1 like');
    expect(likeTexts.label(true, 2)).toBe('Unlike, 2 likes');
  });
});

describe('screens in Russian', () => {
  it('Blog card: the heart is labelled in Russian and the link marker stays translated', async () => {
    setStore(fakeStore('S1', { materials: [A], materialLikes: [like('M', 1), like('S1', 2)] }));
    await render(ru(<MaterialsScreen />));
    expect(screen.getByRole('button', { name: 'Убрать лайк, 2 лайка' })).toBeTruthy();
    expect(screen.getByText(/🔗 ссылка/)).toBeTruthy();
    expect(screen.queryByText(/🔗 link/)).toBeNull();
  });

  it('post page: the heart in Russian, and Open link translated', async () => {
    params.id = 'A';
    setStore(fakeStore('S1', { materials: [A], materialLikes: [like('M', 1)] }));
    await render(ru(<MaterialDetailScreen />));
    expect(screen.getByRole('button', { name: 'Поставить лайк, 1 лайк' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть ссылку' })).toBeTruthy();
    expect(screen.queryByText('Open link')).toBeNull();
  });
});
