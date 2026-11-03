// QA ARU-76: gaps in aru76-change-password.test.tsx: Cancel leaves without saving (and goes to Profile when there is no
// screen to go back to), "Passwords don't match" never shows while the confirmation is empty and goes away once they
// match, a 5-character new password keeps Save disabled, a password of 6 spaces is accepted as typed, and the
// autofill hints and placeholder.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import ChangePasswordScreen from '@/app/change-password';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const isDisabled = (name: string | RegExp) => !!button(name).props.accessibilityState?.disabled;
const input = (id: string) => screen.getByTestId(id);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

it('AC2: Cancel goes back without saving', async () => {
  const changePassword = jest.fn(async () => {});
  setStore(fakeStore('S1', { changePassword }));
  jest.mocked(router.canGoBack).mockReturnValue(true);
  await render(<ChangePasswordScreen />);
  await fireEvent.changeText(input('current-password'), 'oldpass');
  await fireEvent.press(button('Cancel'));
  expect(router.back).toHaveBeenCalled();
  expect(changePassword).not.toHaveBeenCalled();
});

it('AC2: Cancel with nothing to go back to opens Profile', async () => {
  setStore(fakeStore('S1'));
  jest.mocked(router.canGoBack).mockReturnValue(false);
  await render(<ChangePasswordScreen />);
  await fireEvent.press(button('Cancel'));
  expect(router.replace).toHaveBeenCalledWith('/profile');
});

it('AC3: no "Passwords don\'t match" while the confirmation is empty; it goes once they match', async () => {
  setStore(fakeStore('S1'));
  await render(<ChangePasswordScreen />);
  await fireEvent.changeText(input('new-password'), 'secret6');
  expect(screen.queryByText("Passwords don't match")).toBeNull();
  await fireEvent.changeText(input('confirm-password'), 'secret');
  expect(screen.getByText("Passwords don't match")).toBeTruthy();
  await fireEvent.changeText(input('confirm-password'), 'secret6');
  expect(screen.queryByText("Passwords don't match")).toBeNull();
});

it('AC3: a new password of 5 characters keeps Save disabled even with everything else filled', async () => {
  setStore(fakeStore('S1'));
  await render(<ChangePasswordScreen />);
  await fireEvent.changeText(input('current-password'), 'oldpass');
  await fireEvent.changeText(input('new-password'), '12345');
  await fireEvent.changeText(input('confirm-password'), '12345');
  expect(isDisabled('Save')).toBe(true);
});

it('edge: a new password of 6 spaces is accepted and sent as typed (never trimmed)', async () => {
  const changePassword = jest.fn(async () => {});
  setStore(fakeStore('S1', { changePassword }));
  await render(<ChangePasswordScreen />);
  await fireEvent.changeText(input('current-password'), 'oldpass');
  await fireEvent.changeText(input('new-password'), '      ');
  await fireEvent.changeText(input('confirm-password'), '      ');
  expect(isDisabled('Save')).toBe(false);
  await fireEvent.press(button('Save'));
  expect(changePassword).toHaveBeenCalledWith('oldpass', '      ');
});

it('AC2: autofill hints and the sign-up placeholder', async () => {
  setStore(fakeStore('S1'));
  await render(<ChangePasswordScreen />);
  expect(input('current-password').props.autoComplete).toBe('current-password');
  expect(input('new-password').props.placeholder).toBe('At least 6 characters');
  expect(input('confirm-password').props.secureTextEntry).toBe(true);
});
