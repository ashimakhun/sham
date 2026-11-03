// ARU-86: the teacher deletes any Knowledge base PDF; editing stays author-only. Access rules:
// supabase/tests/aru86_teacher_deletes_any_pdf.test.sql.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import MaterialFileScreen from '@/app/materials/files/[id]';
import type { Course, MaterialFile } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { expoRouter, params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const file = (id: string, over: Partial<MaterialFile> = {}): MaterialFile => ({
  id,
  authorId: 'M',
  name: `Book ${id}`,
  description: '',
  storagePath: `M/${id}.pdf`,
  sizeBytes: 1024,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const H: Course = { id: 'H', title: 'Hidden', description: '', createdById: 'M', createdAt: '2026-10-05T10:00:00.000Z', hidden: true };
const files = [
  file('m'),
  file('own', { authorId: 'T', storagePath: 'T/own.pdf' }),
  file('demoted', { authorId: 'S3', storagePath: 'S3/demoted.pdf' }),
  file('gone', { authorId: 'deleted-user', storagePath: 'deleted-user/gone.pdf' }),
  file('hidden', { courseId: 'H', courseOnly: true }),
];
const forRole = (who: string, over = {}) => fakeStore(who, { materialFiles: files, courses: [H], ...over });

const edit = () => screen.queryByRole('button', { name: 'Edit' });
const del = () => screen.queryByRole('button', { name: 'Delete' });

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  expoRouter.router.canGoBack.mockReturnValue(true);
});

it.each(['m', 'demoted', 'gone', 'hidden'])('AC1 / AC4 / AC5: the teacher sees Delete but not Edit on %s', async (id) => {
  params.id = id;
  setStore(forRole('T'));
  await render(<MaterialFileScreen />);
  expect(del()).toBeTruthy();
  expect(edit()).toBeNull();
});

it('AC2 / AC3: same confirmation; Delete removes it and goes back', async () => {
  params.id = 'm';
  const store = forRole('T');
  setStore(store);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === 'Delete')?.onPress?.();
  });
  await render(<MaterialFileScreen />);
  await fireEvent.press(del()!);
  expect(alert.mock.calls[0][0]).toBe('Delete file?');
  expect(alert.mock.calls[0][1]).toBe('"Book m" and its PDF will be removed for everyone.');
  expect(store.deleteMaterialFile).toHaveBeenCalledWith('m');
  expect(expoRouter.router.back).toHaveBeenCalled();
});

it('AC2: Cancel deletes nothing', async () => {
  params.id = 'm';
  const store = forRole('T');
  setStore(store);
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === 'Cancel')?.onPress?.();
  });
  await render(<MaterialFileScreen />);
  await fireEvent.press(del()!);
  expect(store.deleteMaterialFile).not.toHaveBeenCalled();
});

it('AC6: the teacher still sees Edit and Delete on their own PDF', async () => {
  params.id = 'own';
  setStore(forRole('T'));
  await render(<MaterialFileScreen />);
  expect(edit()).toBeTruthy();
  expect(del()).toBeTruthy();
});

it('AC7: a mentor sees Edit and Delete on their own PDF only', async () => {
  params.id = 'm';
  setStore(forRole('M'));
  const view = await render(<MaterialFileScreen />);
  expect(edit()).toBeTruthy();
  expect(del()).toBeTruthy();
  params.id = 'own';
  await view.rerender(<MaterialFileScreen />);
  expect(edit()).toBeNull();
  expect(del()).toBeNull();
});

it('AC8: a student never sees Edit or Delete', async () => {
  params.id = 'm';
  setStore(forRole('S1'));
  await render(<MaterialFileScreen />);
  expect(edit()).toBeNull();
  expect(del()).toBeNull();
});

it('AC9: someone no longer the teacher sees no Delete on others\' PDFs', async () => {
  params.id = 'm';
  setStore(forRole('T', { currentUser: { ...users.T, role: 'mentor' } }));
  await render(<MaterialFileScreen />);
  expect(del()).toBeNull();
});

it('AC10: an error (already gone, offline) shows on the screen and nothing breaks', async () => {
  params.id = 'm';
  setStore(forRole('T', { deleteMaterialFile: jest.fn().mockRejectedValue(new Error('You can no longer delete this file.')) }));
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === 'Delete')?.onPress?.();
  });
  await render(<MaterialFileScreen />);
  await fireEvent.press(del()!);
  expect(screen.getByText('You can no longer delete this file.')).toBeTruthy();
  expect(expoRouter.router.back).not.toHaveBeenCalled();
});
