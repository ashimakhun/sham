// ARU-141: in Russian the course payments period editor's save button reads «Сохранить», not «Сохранить период».
// English keeps «Save period» (aru65 tests); the paid courses list keeps «Выбрать».
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CoursePaymentsScreen from '@/app/accountant/[id]';
import { I18nContext, make } from '@/i18n/context';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import type { CourseBilling } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const inRu = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const bill: CourseBilling = { courseId: 'A', startDay: 1, endDay: 5, selectedById: 'M', selectedAt: '2026-11-01T10:00:00.000Z' };

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

it('AC1/AC4: the Russian period editor saves with «Сохранить»', async () => {
  const store = fakeStore('T', { courseBilling: [bill] });
  setStore(store);
  await render(inRu(<CoursePaymentsScreen />));
  await fireEvent.press(screen.getByRole('button', { name: 'Изменить период' }));
  expect(screen.queryByRole('button', { name: 'Сохранить период' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Последний день, позже' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(store.setBillingPeriod).toHaveBeenCalledWith('A', 1, 6));
});

it('AC5/AC6: English and the Select button are unchanged', () => {
  expect((en as Record<string, string>)['accountant.savePeriod']).toBe('Save period');
  expect((ru as Record<string, string>)['accountant.select']).toBe('Выбрать');
});
