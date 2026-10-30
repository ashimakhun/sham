// ARU-26 QA additions to aru26-mentor-materials.test.tsx, from the TEST DESIGN: AC 10 double tap, share errors
// keep the entered text, a student opening /materials/new directly, AC 4 "Material not found" for someone who had
// the deleted material open, "Open link" on a mentor material, and a mentor's newly shared material on top.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import NewMaterialScreen from '@/app/materials/new';
import { formatDate } from '@/lib/theme';
import type { Material } from '@/lib/types';
import { router } from 'expo-router';

import { fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const TITLE = 'e.g. Lesson 3: Decimals';
const CONTENT = 'Explanation, instructions, what to read…';
const LINK = 'https://…';

const mat = (id: string, teacherId: string, createdAt: string, link?: string): Material => ({
  id,
  teacherId,
  title: `Material ${id}`,
  body: 'Body',
  link,
  createdAt,
});

beforeEach(() => jest.clearAllMocks());

describe('New material (AC 2 / AC 10 / edge cases)', () => {
  it('AC10: while sharing, the button says "Sharing…" and a second tap does not share twice', async () => {
    let finish!: () => void;
    const addMaterial = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setStore(fakeStore('M', { addMaterial }));
    await render(<NewMaterialScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText(TITLE), 'Notes');
    await fireEvent.changeText(screen.getByPlaceholderText(CONTENT), 'Read ch. 2');
    void fireEvent.press(screen.getByRole('button', { name: 'Share with class' }));
    const sharing = await screen.findByRole('button', { name: 'Sharing…' });
    expect(sharing).toBeDisabled();
    void fireEvent.press(sharing);
    await act(async () => finish());
    expect(addMaterial).toHaveBeenCalledTimes(1);
  });

  it('AC10: a whitespace-only title keeps the button disabled; a link is passed as typed', async () => {
    const addMaterial = jest.fn(async () => {});
    setStore(fakeStore('M', { addMaterial }));
    await render(<NewMaterialScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText(TITLE), '   ');
    await fireEvent.changeText(screen.getByPlaceholderText(CONTENT), 'Read ch. 2');
    expect(screen.getByRole('button', { name: 'Share with class' })).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText(TITLE), 'Notes');
    await fireEvent.changeText(screen.getByPlaceholderText(LINK), 'https://example.com/notes');
    await fireEvent.press(screen.getByRole('button', { name: 'Share with class' }));
    expect(addMaterial).toHaveBeenCalledWith({ title: 'Notes', body: 'Read ch. 2', link: 'https://example.com/notes' });
  });

  it('edge (offline): a failed share shows the error, keeps the text and stays on the form', async () => {
    const addMaterial = jest.fn().mockRejectedValue(new Error('Network request failed'));
    setStore(fakeStore('M', { addMaterial }));
    await render(<NewMaterialScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText(TITLE), 'Notes');
    await fireEvent.changeText(screen.getByPlaceholderText(CONTENT), 'Read ch. 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Share with class' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByDisplayValue('Notes')).toBeTruthy();
    expect(screen.getByDisplayValue('Read ch. 2')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('AC7 / role changed while open: a student who reaches the form gets the store refusal, nothing is shared', async () => {
    const addMaterial = jest.fn().mockRejectedValue(new Error('Only a teacher or mentor can do this.'));
    setStore(fakeStore('S1', { addMaterial }));
    await render(<NewMaterialScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText(TITLE), 'Notes');
    await fireEvent.changeText(screen.getByPlaceholderText(CONTENT), 'Read ch. 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Share with class' }));
    expect(await screen.findByText('Only a teacher or mentor can do this.')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('Materials list and details', () => {
  it("AC2/AC3: a mentor's new material is on top with the mentor's name and date", async () => {
    const older = mat('t1', 'T', '2026-10-20T10:00:00.000Z');
    const newest = mat('m1', 'M', '2026-10-30T09:00:00.000Z');
    setStore(fakeStore('N', { materials: [older, newest] }));
    await render(<MaterialsScreen />);
    expect(screen.getAllByText(/^Material /).map((n) => n.props.children)).toEqual(['Material m1', 'Material t1']);
    expect(screen.getByText(`Mentor Max · ${formatDate(newest.createdAt)}`)).toBeTruthy();
  });

  it('AC4: someone who had the material open sees "Material not found" after the live update', async () => {
    params.id = 'm1';
    const m1 = mat('m1', 'M', '2026-10-30T09:00:00.000Z');
    setStore(fakeStore('S1', { materials: [m1] }));
    const view = await render(<MaterialDetailScreen />);
    expect(screen.getByText('Material m1')).toBeTruthy();
    setStore(fakeStore('S1', { materials: [] }));
    await view.rerender(<MaterialDetailScreen />);
    expect(screen.getByText('Material not found')).toBeTruthy();
  });

  it('edge: "Open link" works the same on a mentor material', async () => {
    params.id = 'm1';
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    setStore(fakeStore('S1', { materials: [mat('m1', 'M', '2026-10-30T09:00:00.000Z', 'https://example.com/notes')] }));
    await render(<MaterialDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open link' }));
    expect(spy).toHaveBeenCalledWith('https://example.com/notes');
    spy.mockRestore();
  });

  it('AC4: the author mentor sees Delete on their material and the author name on details', async () => {
    params.id = 'm1';
    setStore(fakeStore('M', { materials: [mat('m1', 'M', '2026-10-30T09:00:00.000Z')] }));
    await render(<MaterialDetailScreen />);
    expect(screen.getByRole('button', { name: 'Delete material' })).toBeTruthy();
    expect(screen.getByText(/Mentor Max ·/)).toBeTruthy();
  });
});
