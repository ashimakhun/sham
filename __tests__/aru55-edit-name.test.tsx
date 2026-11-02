// ARU-55: users edit their own name on the Profile tab. The database rules (own row only, no blank names) are tested
// in supabase/tests/aru55_edit_name.test.sql.
import { fireEvent, render, screen } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import { NAME_TOO_LONG, nameProblem } from '@/lib/profileName';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

beforeEach(() => jest.clearAllMocks());

const save = () => screen.getByRole('button', { name: /^(Save|Saving…)$/ });
const disabled = (el: ReturnType<typeof save>) => el.props.accessibilityState?.disabled === true;

async function openForm(who: keyof typeof users = 'S1', over = {}) {
  const store = fakeStore(who, over);
  setStore(store);
  const view = await render(<ProfileScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Edit name' }));
  return { store, view };
}

describe('Entry point and form (AC 1, 2)', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees "Edit name" on the name card', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    expect(screen.getByText(users[who].name)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit name' })).toBeTruthy();
  });

  it('opens a field pre-filled with the current name, focused, with Save and Cancel', async () => {
    await openForm();
    const field = screen.getByDisplayValue('Student Sam');
    expect(field.props.autoFocus).toBe(true);
    expect(field.props.autoComplete).toBe('name');
    expect(field.props.autoCapitalize).toBe('words');
    expect(save()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull();
  });
});

describe('Save (AC 3, 4)', () => {
  it('saves the trimmed name and closes the form', async () => {
    const { store } = await openForm();
    await fireEvent.changeText(screen.getByDisplayValue('Student Sam'), '  Dana Serikova ');
    await fireEvent.press(save());
    expect(store.updateMyName).toHaveBeenCalledTimes(1);
    expect(store.updateMyName).toHaveBeenCalledWith('Dana Serikova');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit name' })).toBeTruthy();
  });

  it('allows non-Latin names and emoji', async () => {
    const { store } = await openForm('M');
    await fireEvent.changeText(screen.getByDisplayValue('Mentor Max'), 'Мақсат 🙂');
    await fireEvent.press(save());
    expect(store.updateMyName).toHaveBeenCalledWith('Мақсат 🙂');
  });
});

describe('Validation (AC 5–7)', () => {
  it.each(['', '   '])('a blank name (%j) disables Save and sends nothing', async (text) => {
    const { store } = await openForm();
    await fireEvent.changeText(screen.getByDisplayValue('Student Sam'), text);
    expect(disabled(save())).toBe(true);
    await fireEvent.press(save());
    expect(store.updateMyName).not.toHaveBeenCalled();
  });

  it('80 characters is allowed, 81 shows the message and disables Save', async () => {
    await openForm();
    await fireEvent.changeText(screen.getByDisplayValue('Student Sam'), `  ${'a'.repeat(80)}  `);
    expect(disabled(save())).toBe(false);
    expect(screen.queryByText(NAME_TOO_LONG)).toBeNull();
    await fireEvent.changeText(screen.getByDisplayValue(`  ${'a'.repeat(80)}  `), 'a'.repeat(81));
    expect(screen.getByText('Name must be 80 characters or fewer')).toBeTruthy();
    expect(disabled(save())).toBe(true);
  });

  it('an unchanged name (after trimming) disables Save', async () => {
    const { store } = await openForm();
    expect(disabled(save())).toBe(true);
    await fireEvent.changeText(screen.getByDisplayValue('Student Sam'), 'Student Sam ');
    expect(disabled(save())).toBe(true);
    await fireEvent.press(save());
    expect(store.updateMyName).not.toHaveBeenCalled();
  });

  it('nameProblem() follows the same rules', () => {
    expect(nameProblem('  ')).not.toBeNull();
    expect(nameProblem('a'.repeat(81))).toBe(NAME_TOO_LONG);
    expect(nameProblem(` ${'a'.repeat(80)} `)).toBeNull();
  });
});

describe('Cancel, busy and error (AC 8, 9)', () => {
  it('Cancel closes the form without saving; reopening shows the old name', async () => {
    const { store } = await openForm();
    await fireEvent.changeText(screen.getByDisplayValue('Student Sam'), 'Someone Else');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(store.updateMyName).not.toHaveBeenCalled();
    expect(screen.getByText('Student Sam')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Edit name' }));
    expect(screen.getByDisplayValue('Student Sam')).toBeTruthy();
  });

  it('while saving, Save shows the busy state and a second tap sends nothing', async () => {
    let finish = () => {};
    const updateMyName = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    await openForm('S1', { updateMyName });
    await fireEvent.changeText(screen.getByDisplayValue('Student Sam'), 'Dana');
    await fireEvent.press(save());
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
    expect(disabled(save())).toBe(true);
    await fireEvent.press(save());
    expect(updateMyName).toHaveBeenCalledTimes(1);
    finish();
  });

  it('a failed save keeps the form open with the typed text and shows the error; the old name stays', async () => {
    const updateMyName = jest.fn().mockRejectedValue(new Error('Network request failed'));
    await openForm('S1', { updateMyName });
    await fireEvent.changeText(screen.getByDisplayValue('Student Sam'), 'Dana');
    await fireEvent.press(save());
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(screen.getByDisplayValue('Dana')).toBeTruthy();
    expect(screen.getByText('Student Sam')).toBeTruthy();
    expect(disabled(save())).toBe(false);
  });
});
