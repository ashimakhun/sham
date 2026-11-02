// QA ARU-55: gaps in aru55-edit-name.test.tsx: the keyboard's Done key follows the same rules as Save, Unicode
// spaces count as blank, 80 characters plus surrounding spaces is fine, emoji count by JavaScript length, and a long
// name wraps on the card.
import { fireEvent, render, screen } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

beforeEach(() => jest.clearAllMocks());

const save = () => screen.getByRole('button', { name: /^(Save|Saving…)$/ });
const disabled = () => save().props.accessibilityState?.disabled === true;

async function openForm(who: keyof typeof users = 'S1', over: Parameters<typeof fakeStore>[1] = {}) {
  const store = fakeStore(who, over);
  setStore(store);
  await render(<ProfileScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Edit name' }));
  return store;
}
const field = () => screen.getByDisplayValue(/.*/);

it.each([
  ['blank', ''],
  ['unchanged', 'Student Sam  '],
  ['too long', 'x'.repeat(81)],
])('AC 5–7: the keyboard Done key with a %s name sends nothing', async (_k, text) => {
  const store = await openForm();
  await fireEvent.changeText(field(), text);
  await fireEvent(field(), 'submitEditing');
  expect(store.updateMyName).not.toHaveBeenCalled();
});

it('AC 3: the keyboard Done key with a valid name saves it, trimmed', async () => {
  const store = await openForm();
  await fireEvent.changeText(field(), '  Dana Serikova ');
  await fireEvent(field(), 'submitEditing');
  expect(store.updateMyName).toHaveBeenCalledWith('Dana Serikova');
});

it('AC 5: non-breaking and other Unicode spaces only count as blank', async () => {
  await openForm();
  await fireEvent.changeText(field(), '  　');
  expect(disabled()).toBe(true);
});

it('AC 6: 80 characters with spaces around them are allowed (trimmed)', async () => {
  const store = await openForm();
  await fireEvent.changeText(field(), `   ${'a'.repeat(80)}   `);
  expect(screen.queryByText('Name must be 80 characters or fewer')).toBeNull();
  expect(disabled()).toBe(false);
  await fireEvent.press(save());
  expect(store.updateMyName).toHaveBeenCalledWith('a'.repeat(80));
});

it('edge: emoji count by JavaScript string length (41 two-unit emoji are over 80)', async () => {
  await openForm();
  await fireEvent.changeText(field(), '🙂'.repeat(41));
  expect(screen.getByText('Name must be 80 characters or fewer')).toBeTruthy();
  expect(disabled()).toBe(true);
  await fireEvent.changeText(field(), '🙂'.repeat(40));
  expect(screen.queryByText('Name must be 80 characters or fewer')).toBeNull();
  expect(disabled()).toBe(false);
});

it('edge: a long name wraps on the card (no line limit)', async () => {
  const long = 'Very Long Name '.repeat(10).trim();
  setStore(fakeStore('S1', { currentUser: { ...users.S1, name: long } }));
  await render(<ProfileScreen />);
  expect(screen.getByText(long).props.numberOfLines).toBeUndefined();
});

it('AC 6: an existing name over 80 characters is shown as is; saving it unchanged is disabled', async () => {
  const long = 'n'.repeat(90);
  await openForm('S1', { currentUser: { ...users.S1, name: long } });
  expect(screen.getAllByText(long).length).toBeGreaterThan(0);
  expect(disabled()).toBe(true);
});
