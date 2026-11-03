// ARU-71: a pencil right after the name on the Profile card replaces the "Edit name" text link. Everything else of
// ARU-55 (validation, saving) is covered by aru55-edit-name*.test.tsx.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import { EDIT_NAME_ICON } from '@/components/ProfileNameCard';
import { colors } from '@/lib/theme';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

beforeEach(() => jest.clearAllMocks());

const pencil = () => screen.getByRole('button', { name: 'Edit name' });
const icon = () => screen.queryByTestId(`icon-${EDIT_NAME_ICON}`); // jest.setup.js mocks Ionicons this way
type Node = { props: Record<string, unknown>; children?: unknown[]; parent?: Node | null; type?: unknown };
const styleOf = (el: ReturnType<typeof pencil>) =>
  StyleSheet.flatten(typeof el.props.style === 'function' ? el.props.style({ pressed: false }) : el.props.style);

describe('AC1 / AC2: the pencil instead of the text link', () => {
  it.each(['S1', 'M', 'T'] as const)('%s: a create-outline pencil in colors.primary, no "Edit name" text', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    expect(EDIT_NAME_ICON).toBe('create-outline'); // the same glyph as ARU-70's discipline pencil
    expect(icon()).toBeTruthy();
    expect(icon()!.props.color).toBe(colors.primary);
    expect(screen.queryByText('Edit name')).toBeNull();
    expect(pencil()).toBeTruthy();
  });

  it('the pencil sits on the same row as the name, directly after it', async () => {
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    const name = screen.getByText(users.S1.name) as unknown as Node;
    const row = name.parent as Node;
    const rowStyle = StyleSheet.flatten(row.props.style as never) as { flexDirection?: string };
    expect(rowStyle.flexDirection).toBe('row');
    const kids = (row.children ?? []) as Node[];
    expect(kids.indexOf(name)).toBe(0);
    expect(kids[1]).toBe(pencil() as unknown as Node);
  });
});

describe('AC3 / AC4: open and close the form', () => {
  it('tapping opens the ARU-55 form; the pencil hides while editing and comes back on Cancel', async () => {
    setStore(fakeStore('M'));
    await render(<ProfileScreen />);
    await fireEvent.press(pencil());
    const field = screen.getByDisplayValue('Mentor Max');
    expect(field.props.autoFocus).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull();
    expect(icon()).toBeNull();
    expect(screen.getByText('Mentor Max')).toBeTruthy(); // the stored name stays above the form
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(pencil()).toBeTruthy();
  });

  it('after a successful save the pencil is back', async () => {
    const store = fakeStore('T');
    setStore(store);
    await render(<ProfileScreen />);
    await fireEvent.press(pencil());
    await fireEvent.changeText(screen.getByDisplayValue('Teacher Tess'), 'Tess Abenova');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.updateMyName).toHaveBeenCalledWith('Tess Abenova'));
    await waitFor(() => expect(pencil()).toBeTruthy());
  });

  it('a failed save keeps the form open and the pencil hidden', async () => {
    setStore(fakeStore('S1', { updateMyName: jest.fn(async () => Promise.reject(new Error('Network request failed'))) }));
    await render(<ProfileScreen />);
    await fireEvent.press(pencil());
    await fireEvent.changeText(screen.getByDisplayValue('Student Sam'), 'Sam Two');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull();
    expect(screen.getByText('Student Sam')).toBeTruthy();
  });

  it('edge: a double tap opens the form once', async () => {
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    const btn = pencil();
    await fireEvent.press(btn);
    await fireEvent.press(btn);
    expect(screen.getAllByDisplayValue('Student Sam')).toHaveLength(1);
  });
});

describe('AC5–AC7: touch area, long names, screen readers', () => {
  it('AC5: the touch area is at least 44×44 pt', async () => {
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    const style = styleOf(pencil());
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  });

  it('AC6: a long name shrinks and wraps; the pencil keeps its fixed size', async () => {
    const long = 'Ақбота '.repeat(11).trim(); // 76 characters, non-Latin
    const store = fakeStore('S1');
    setStore({ ...store, currentUser: { ...users.S1, name: long } });
    await render(<ProfileScreen />);
    const name = screen.getByText(long);
    expect(StyleSheet.flatten(name.props.style).flexShrink).toBe(1);
    expect(name.props.numberOfLines).toBeUndefined(); // wraps, never cut
    expect(styleOf(pencil()).width).toBe(44);
  });

  it('AC7: the pencil is a button labelled "Edit name"; the name is its own text', async () => {
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    expect(pencil().props.accessibilityRole).toBe('button');
    expect(screen.getByText('Student Sam').props.accessibilityLabel).toBeUndefined();
  });

  it('tapping the name itself does not open the form', async () => {
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByText('Student Sam'));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
