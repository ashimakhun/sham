// ARU-26: mentors share materials and delete their own, like the teacher. Students read only.
import { fireEvent, render, screen } from '@testing-library/react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import NewMaterialScreen from '@/app/materials/new';
import type { Material } from '@/lib/types';
import { router } from 'expo-router';

import { fakeStore, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const SHARE = '+ Share material';
const DELETE = 'Delete material';
const SHARER_HINT = 'Share a lesson, notes or a link with your class.';
const STUDENT_HINT = 'Your teacher and mentors have not shared anything yet.';

const mat = (id: string, teacherId: string, createdAt = '2026-10-20T10:00:00.000Z'): Material => ({
  id,
  teacherId,
  title: `Material ${id}`,
  body: 'Body',
  createdAt,
});
const byMax = mat('m1', 'M', '2026-10-21T10:00:00.000Z');
const byTess = mat('t1', 'T');
const byNina = mat('n1', 'N');
const all = [byTess, byMax, byNina];

beforeEach(() => jest.clearAllMocks());

describe('AC1/AC7/AC9: Materials tab', () => {
  it.each(['M', 'T'] as const)('%s sees "+ Share material" and the sharer empty hint', async (who) => {
    setStore(fakeStore(who));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: SHARE }));
    expect(router.push).toHaveBeenCalledWith('/materials/new');
    expect(screen.getByText(SHARER_HINT)).toBeTruthy();
  });

  it('a student sees no share button and a hint that names teacher and mentors', async () => {
    setStore(fakeStore('S1'));
    await render(<MaterialsScreen />);
    expect(screen.queryByRole('button', { name: SHARE })).toBeNull();
    expect(screen.getByText(STUDENT_HINT)).toBeTruthy();
  });
});

it('AC3: a mentor material shows the mentor as author, newest first, for a student', async () => {
  setStore(fakeStore('S1', { materials: all }));
  await render(<MaterialsScreen />);
  const titles = screen.getAllByText(/^Material /).map((n) => n.props.children);
  expect(titles[0]).toBe('Material m1');
  expect(screen.getByText(/Mentor Max ·/)).toBeTruthy();
});

it('AC2/AC10: a mentor shares through the form; empty title/content keeps the button disabled', async () => {
  const addMaterial = jest.fn(async () => {});
  setStore(fakeStore('M', { addMaterial }));
  await render(<NewMaterialScreen />);
  const button = () => screen.getByRole('button', { name: 'Share with class' });
  expect(button()).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText('e.g. Lesson 3: Decimals'), 'Notes');
  await fireEvent.changeText(screen.getByPlaceholderText('Explanation, instructions, what to read…'), '   ');
  expect(button()).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText('Explanation, instructions, what to read…'), 'Read ch. 2');
  await fireEvent.press(button());
  expect(addMaterial).toHaveBeenCalledWith({ title: 'Notes', body: 'Read ch. 2', link: '' });
  expect(router.back).toHaveBeenCalled();
});

describe('AC4/AC5/AC6/AC7/AC8: Delete material', () => {
  const open = async (who: keyof typeof users, id: string, over = {}) => {
    params.id = id;
    setStore(fakeStore(who, { materials: all, ...over }));
    await render(<MaterialDetailScreen />);
  };

  it('AC4: a mentor deletes their own material and goes back', async () => {
    const deleteMaterial = jest.fn(async () => {});
    await open('M', 'm1', { deleteMaterial });
    expect(screen.getByText(/Mentor Max ·/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: DELETE }));
    expect(deleteMaterial).toHaveBeenCalledWith('m1');
    expect(router.back).toHaveBeenCalled();
  });

  it.each([
    ['AC5: mentor on a teacher material', 'M', 't1'],
    ['AC5: mentor on another mentor material', 'M', 'n1'],
    ['AC6: teacher on a mentor material', 'T', 'm1'],
    ['AC7: student on any material', 'S1', 'm1'],
  ] as const)('%s → no Delete', async (_l, who, id) => {
    await open(who, id);
    expect(screen.queryByRole('button', { name: DELETE })).toBeNull();
  });

  it('regression: the teacher still sees Delete on their own material', async () => {
    await open('T', 't1');
    expect(screen.getByRole('button', { name: DELETE })).toBeTruthy();
  });

  it('AC8: the author made a student no longer sees Delete', async () => {
    params.id = 'm1';
    const store = fakeStore('M', { materials: all });
    setStore({ ...store, currentUser: { ...users.M, role: 'student' } });
    await render(<MaterialDetailScreen />);
    expect(screen.getByText('Material m1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: DELETE })).toBeNull();
  });

  it('edge: a refused delete shows the error and stays on the screen', async () => {
    const deleteMaterial = jest.fn(async () => {
      throw new Error('You can no longer delete this material.');
    });
    await open('M', 'm1', { deleteMaterial });
    await fireEvent.press(screen.getByRole('button', { name: DELETE }));
    expect(await screen.findByText('You can no longer delete this material.')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });
});
