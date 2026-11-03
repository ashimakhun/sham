// QA ARU-77: gaps in aru77-forgot-password.test.tsx: a code longer than 10 digits is cut to 10, a resend that fails
// shows its error and stays on the code step, a failed reset can be followed by a new code once the cooldown is over,
// Back to sign in with nothing to go back to opens the sign-in screen, and the neutral message names the trimmed
// address the code went to.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import ResetPasswordScreen from '@/app/reset-password';

import { fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => ({ ...require('./helpers/mocks').expoRouter, Redirect: () => null }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const isDisabled = (name: string | RegExp) => !!button(name).props.accessibilityState?.disabled;

beforeEach(() => {
  jest.clearAllMocks();
  delete params.email;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.useRealTimers());

async function toCodeStep(store = fakeStore(null)) {
  params.email = 'sam@example.com';
  setStore(store);
  await render(<ResetPasswordScreen />);
  await fireEvent.press(button('Send code'));
}

it('AC4: a code longer than 10 digits is cut to 10', async () => {
  await toCodeStep();
  await fireEvent.changeText(screen.getByTestId('reset-code'), '123456789012');
  expect(screen.getByTestId('reset-code').props.value).toBe('1234567890');
});

it('AC9: a resend that fails shows its error and stays on the code step', async () => {
  jest.useFakeTimers();
  const requestPasswordReset = jest
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Too many requests. Please wait a few minutes and try again.'));
  await toCodeStep(fakeStore(null, { requestPasswordReset }));
  await act(async () => {
    jest.advanceTimersByTime(61_000);
  });
  await fireEvent.press(button('Send a new code'));
  expect(screen.getByText('Too many requests. Please wait a few minutes and try again.')).toBeTruthy();
  expect(screen.getByTestId('reset-code')).toBeTruthy();
});

it('AC8: after a failed reset the user can send a new code once the cooldown is over; the old error clears', async () => {
  jest.useFakeTimers();
  const resetPasswordWithCode = jest.fn(async () => {
    throw new Error('Password should be at least 8 characters.');
  });
  const store = fakeStore(null, { resetPasswordWithCode });
  await toCodeStep(store);
  await fireEvent.changeText(screen.getByTestId('reset-code'), '123456');
  await fireEvent.changeText(screen.getByTestId('new-password'), 'secret6');
  await fireEvent.changeText(screen.getByTestId('confirm-password'), 'secret6');
  await fireEvent.press(button('Reset password'));
  expect(screen.getByText('Password should be at least 8 characters.')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(61_000);
  });
  expect(isDisabled('Send a new code')).toBe(false);
  await fireEvent.press(button('Send a new code'));
  expect(store.requestPasswordReset).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Password should be at least 8 characters.')).toBeNull();
});

it('AC10: Back to sign in with nothing to go back to opens the sign-in screen', async () => {
  setStore(fakeStore(null));
  jest.mocked(router.canGoBack).mockReturnValue(false);
  await render(<ResetPasswordScreen />);
  await fireEvent.press(button('Back to sign in'));
  expect(router.replace).toHaveBeenCalledWith('/');
});

it('AC3: the neutral message names the trimmed address the code went to', async () => {
  params.email = '  Sam@Example.com  ';
  const store = fakeStore(null);
  setStore(store);
  await render(<ResetPasswordScreen />);
  await fireEvent.press(button('Send code'));
  expect(store.requestPasswordReset).toHaveBeenCalledWith('Sam@Example.com');
  expect(
    screen.getByText("If an account exists for Sam@Example.com, we've sent a code to it. It can take a few minutes."),
  ).toBeTruthy();
});
