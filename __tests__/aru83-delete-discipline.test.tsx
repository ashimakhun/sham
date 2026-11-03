// ARU-83: the teacher's "Delete discipline" on the discipline screen. Store logic: aru83-store-delete-discipline;
// database rules: supabase/tests/aru83_delete_discipline.test.sql.
// D1 (Math) has courses A, B and hidden H; D2 (Art) has none; D3 (Secret) is hidden. C has no discipline.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import DisciplineScreen from '@/app/disciplines/[id]';
import { deleteDisciplineMessage } from '@/components/DeleteDisciplineButton';
import type { Course, Discipline } from '@/lib/types';

import { courseA, courseB, fakeStore } from './helpers/fakeStore';
import { expoRouter, params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const d = (id: string, name: string, hidden = false): Discipline => ({ id, name, hidden, createdById: 'T', createdAt: '2026-11-01T10:00:00.000Z' });
const D1 = d('D1', 'Math');
const D2 = d('D2', 'Art');
const D3 = d('D3', 'Secret', true);
const courses: Course[] = [
  { ...courseA, disciplineId: 'D1' },
  { ...courseB, disciplineId: 'D1' },
  { id: 'H', title: 'Hidden algebra', description: '', createdById: 'M', createdAt: '2026-10-05T10:00:00.000Z', hidden: true, disciplineId: 'D1' },
  { id: 'C', title: 'Chemistry', description: '', createdById: 'N', createdAt: '2026-10-03T10:00:00.000Z' },
];
const forRole = (who: string, over = {}) =>
  fakeStore(who, { courses, disciplines: who === 'T' ? [D1, D2, D3] : [D1, D2], ...over });

const deleteButton = () => screen.queryByText('Delete discipline');

function answerAlert(press: 'Delete' | 'Cancel' | null) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons, options) => {
    if (press === null) options?.onDismiss?.();
    else buttons?.find((b) => b.text === press)?.onPress?.();
  });
}

function texts(): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n === 'string') return void out.push(n);
    walk((n as { children?: unknown }).children);
  };
  walk(screen.toJSON());
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  expoRouter.router.canGoBack.mockReturnValue(true);
});

describe('AC1: who sees Delete discipline', () => {
  it.each(['D1', 'D2', 'D3'])('the teacher sees it on %s, below the COURSES list', async (id) => {
    params.id = id;
    setStore(forRole('T'));
    await render(<DisciplineScreen />);
    expect(deleteButton()).toBeTruthy();
    const all = texts();
    expect(all.indexOf('COURSES')).toBeLessThan(all.indexOf('Delete discipline'));
    expect(all.at(-1)).toBe('Delete discipline');
  });

  it.each(['M', 'N', 'S1'])('%s never sees it', async (who) => {
    params.id = 'D1';
    setStore(forRole(who));
    await render(<DisciplineScreen />);
    expect(deleteButton()).toBeNull();
  });
});

describe('AC2-AC4', () => {
  it('names the discipline and counts every course, hidden ones too', async () => {
    params.id = 'D1';
    setStore(forRole('T'));
    const alert = answerAlert('Cancel');
    await render(<DisciplineScreen />);
    await fireEvent.press(deleteButton()!);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Delete discipline');
    expect(message).toBe(
      'Delete "Math" and its 3 course(s)? Each course\'s meetings, notes, attendance, homework and photos, chat, ' +
        "listeners, feedback and payment settings are deleted too. This can't be undone.",
    );
    expect(buttons?.map((b) => [b.text, b.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Delete', 'destructive'],
    ]);
  });

  it('says so when there are no courses', async () => {
    params.id = 'D2';
    setStore(forRole('T'));
    const alert = answerAlert('Cancel');
    await render(<DisciplineScreen />);
    await fireEvent.press(deleteButton()!);
    expect(alert.mock.calls[0][1]).toBe('Delete "Art"? It has no courses. This can\'t be undone.');
    expect(deleteDisciplineMessage('Art', 0)).toBe(alert.mock.calls[0][1]);
  });

  it.each([['Cancel'], [null]] as const)('%s deletes nothing and stays', async (press) => {
    params.id = 'D1';
    const store = forRole('T');
    setStore(store);
    answerAlert(press);
    await render(<DisciplineScreen />);
    await fireEvent.press(deleteButton()!);
    expect(store.deleteDiscipline).not.toHaveBeenCalled();
    expect(expoRouter.router.back).not.toHaveBeenCalled();
  });

  it('Delete deletes the discipline and goes back to the Courses tab (its Disciplines view kept)', async () => {
    params.id = 'D3';
    const store = forRole('T');
    setStore(store);
    answerAlert('Delete');
    await render(<DisciplineScreen />);
    await fireEvent.press(deleteButton()!);
    expect(store.deleteDiscipline).toHaveBeenCalledWith('D3');
    expect(expoRouter.router.back).toHaveBeenCalledTimes(1);
  });

  it('with no history it lands on the Courses tab', async () => {
    params.id = 'D1';
    setStore(forRole('T'));
    expoRouter.router.canGoBack.mockReturnValue(false);
    answerAlert('Delete');
    await render(<DisciplineScreen />);
    await fireEvent.press(deleteButton()!);
    expect(expoRouter.router.replace).toHaveBeenCalledWith('/courses');
  });
});

describe('AC7-AC9', () => {
  it('"Deleting…", disabled, and a double tap sends one request', async () => {
    params.id = 'D1';
    let finish: () => void = () => {};
    const store = forRole('T', { deleteDiscipline: jest.fn(() => new Promise<void>((r) => (finish = r))) });
    setStore(store);
    const alert = answerAlert('Delete');
    await render(<DisciplineScreen />);
    const button = deleteButton()!;
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(screen.getByText('Deleting…')).toBeTruthy();
    await fireEvent.press(screen.getByText('Deleting…'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(store.deleteDiscipline).toHaveBeenCalledTimes(1);
    finish();
  });

  it('an error (e.g. offline) shows on the screen and tapping again retries', async () => {
    params.id = 'D1';
    const deleteDiscipline = jest.fn().mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce(undefined);
    setStore(forRole('T', { deleteDiscipline }));
    answerAlert('Delete');
    await render(<DisciplineScreen />);
    await fireEvent.press(deleteButton()!);
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(expoRouter.router.back).not.toHaveBeenCalled();
    await fireEvent.press(deleteButton()!);
    expect(deleteDiscipline).toHaveBeenCalledTimes(2);
    expect(expoRouter.router.back).toHaveBeenCalledTimes(1);
  });

  it('another user with the screen open sees "Discipline not found" once it is gone', async () => {
    params.id = 'D1';
    setStore(forRole('M'));
    const view = await render(<DisciplineScreen />);
    setStore(forRole('M', { disciplines: [D2], courses: [] }));
    await view.rerender(<DisciplineScreen />);
    expect(screen.getByText('Discipline not found')).toBeTruthy();
  });
});
