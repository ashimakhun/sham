// ARU-77: "Forgot password?" on the sign-in screen and the Reset password screen (fake store). The store side
// (session held until the password is saved, sign-out on failure) is in aru77-store-reset-password.test.tsx.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router, usePreventRemove } from 'expo-router';
import { Alert } from 'react-native';

import SignInScreen from '@/app/index';
import ResetPasswordScreen from '@/app/reset-password';

import { fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => ({ ...require('./helpers/mocks').expoRouter, Redirect: () => null }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const isDisabled = (name: string | RegExp) => !!button(name).props.accessibilityState?.disabled;
const NEUTRAL = (email: string) => `If an account exists for ${email}, we've sent a code to it. It can take a few minutes.`;
const CODE_INVALID = 'This code is wrong or has expired. Check the email or send a new code.';

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  delete params.email;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.useRealTimers());

async function toCodeStep(store = fakeStore(null)) {
  params.email = ' sam@example.com ';
  setStore(store);
  await render(<ResetPasswordScreen />);
  await fireEvent.press(button('Send code'));
}

async function fillCode(code: string, password: string, confirm = password) {
  await fireEvent.changeText(screen.getByTestId('reset-code'), code);
  await fireEvent.changeText(screen.getByTestId('new-password'), password);
  await fireEvent.changeText(screen.getByTestId('confirm-password'), confirm);
}

describe('AC1: Forgot password? on the sign-in screen', () => {
  it('shows in Sign in mode only and opens Reset password with the typed email', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), ' dana@example.com ');
    const link = screen.getByRole('link', { name: 'Forgot password?' });
    await fireEvent.press(link);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/reset-password', params: { email: 'dana@example.com' } });
    await fireEvent.press(screen.getByRole('tab', { name: 'Create account' }));
    expect(screen.queryByText('Forgot password?')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: 'Sign in' }));
    expect(screen.getByText('Forgot password?')).toBeTruthy();
  });
});

describe('AC2–AC3: request a code', () => {
  it('pre-fills the email; Send code is disabled when blank or only spaces', async () => {
    params.email = 'sam@example.com';
    setStore(fakeStore(null));
    await render(<ResetPasswordScreen />);
    expect(screen.getByTestId('reset-email').props.value).toBe('sam@example.com');
    expect(isDisabled('Send code')).toBe(false);
    await fireEvent.changeText(screen.getByTestId('reset-email'), '   ');
    expect(isDisabled('Send code')).toBe(true);
  });

  it('sends one request with the trimmed email and moves to the code step with the neutral message', async () => {
    const requestPasswordReset = jest.fn(async () => {});
    await toCodeStep(fakeStore(null, { requestPasswordReset }));
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(requestPasswordReset).toHaveBeenCalledWith('sam@example.com');
    expect(screen.getByText(NEUTRAL('sam@example.com'))).toBeTruthy();
    expect(screen.getByTestId('reset-code')).toBeTruthy();
  });

  it('a rate-limit or network error on the first send stays on the email step without the neutral text', async () => {
    const msg = 'Too many requests. Please wait a few minutes and try again.';
    const requestPasswordReset = jest.fn(async () => {
      throw new Error(msg);
    });
    await toCodeStep(fakeStore(null, { requestPasswordReset }));
    expect(screen.getByText(msg)).toBeTruthy();
    expect(screen.queryByText(/If an account exists/)).toBeNull();
    expect(screen.getByTestId('reset-email')).toBeTruthy();
  });

  it('AC11: a double tap on Send code sends one request and shows "Please wait…"', async () => {
    let finish!: () => void;
    const requestPasswordReset = jest.fn(() => new Promise<void>((r) => (finish = r)));
    params.email = 'sam@example.com';
    setStore(fakeStore(null, { requestPasswordReset }));
    await render(<ResetPasswordScreen />);
    await fireEvent.press(button('Send code'));
    await fireEvent.press(button('Please wait…'));
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(isDisabled('Please wait…')).toBe(true);
    await act(async () => finish());
    expect(screen.getByTestId('reset-code')).toBeTruthy();
  });
});

describe('AC4: the code step', () => {
  it('code field: digits only, numeric keyboard, one-time-code autofill', async () => {
    await toCodeStep();
    const field = screen.getByTestId('reset-code');
    expect(field.props.keyboardType).toBe('number-pad');
    expect(field.props.autoComplete).toBe('one-time-code');
    expect(field.props.textContentType).toBe('oneTimeCode');
    await fireEvent.changeText(field, '12a 34 56');
    expect(screen.getByTestId('reset-code').props.value).toBe('123456');
    expect(screen.getByTestId('new-password').props.placeholder).toBe('At least 6 characters');
  });

  it('Reset password stays disabled until the code has 6+ digits and the passwords are valid and match', async () => {
    await toCodeStep();
    expect(isDisabled('Reset password')).toBe(true);
    await fillCode('12345', 'secret6');
    expect(isDisabled('Reset password')).toBe(true);
    await fillCode('123456', 'short');
    expect(isDisabled('Reset password')).toBe(true);
    await fillCode('123456', 'secret6', 'secret7');
    expect(isDisabled('Reset password')).toBe(true);
    expect(screen.getByText("Passwords don't match")).toBeTruthy();
    await fillCode('123456', 'secret6');
    expect(isDisabled('Reset password')).toBe(false);
    await fillCode('1234567890', 'secret6');
    expect(isDisabled('Reset password')).toBe(false);
  });
});

describe('AC5, AC7, AC8: resetting', () => {
  it('AC5: success resets with the sent-to email, shows "Password changed" and returns to sign-in (which opens the app)', async () => {
    const resetPasswordWithCode = jest.fn(async () => {});
    await toCodeStep(fakeStore(null, { resetPasswordWithCode }));
    await fillCode('123456', ' new pass ');
    await fireEvent.press(button('Reset password'));
    expect(resetPasswordWithCode).toHaveBeenCalledWith('sam@example.com', '123456', ' new pass ');
    expect(alertSpy).toHaveBeenCalledWith('Password changed', undefined);
    expect(router.back).toHaveBeenCalled();
  });

  it.each([CODE_INVALID, 'Password should be at least 8 characters.', 'The new password must be different from the current one'])(
    'shows "%s", keeps the fields and stays on the screen',
    async (message) => {
      const resetPasswordWithCode = jest.fn(async () => {
        throw new Error(message);
      });
      await toCodeStep(fakeStore(null, { resetPasswordWithCode }));
      await fillCode('123456', 'secret6');
      await fireEvent.press(button('Reset password'));
      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.getByTestId('reset-code').props.value).toBe('123456');
      expect(screen.getByTestId('new-password').props.value).toBe('secret6');
      expect(router.back).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    },
  );

  it('AC11: a double tap on Reset password sends one request; leaving is blocked while it runs', async () => {
    let finish!: () => void;
    const resetPasswordWithCode = jest.fn(() => new Promise<void>((r) => (finish = r)));
    await toCodeStep(fakeStore(null, { resetPasswordWithCode }));
    await fillCode('123456', 'secret6');
    await fireEvent.press(button('Reset password'));
    await fireEvent.press(button('Please wait…'));
    expect(resetPasswordWithCode).toHaveBeenCalledTimes(1);
    expect(jest.mocked(usePreventRemove).mock.calls.at(-1)?.[0]).toBe(true);
    await act(async () => finish());
    expect(jest.mocked(usePreventRemove).mock.calls.at(-1)?.[0]).toBe(false);
  });
});

describe('AC9: Send a new code', () => {
  it('is disabled for 60 seconds with the seconds left, then sends again to the same address', async () => {
    jest.useFakeTimers();
    const requestPasswordReset = jest.fn(async () => {});
    await toCodeStep(fakeStore(null, { requestPasswordReset }));
    expect(button(/^Send a new code \(60s\)$/)).toBeTruthy();
    expect(isDisabled(/^Send a new code/)).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(button(/^Send a new code \((30|29)s\)$/)).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    expect(isDisabled('Send a new code')).toBe(false);
    await fireEvent.press(button('Send a new code'));
    expect(requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(requestPasswordReset).toHaveBeenLastCalledWith('sam@example.com');
    expect(isDisabled(/^Send a new code \(\d+s\)$/)).toBe(true);
  });
});

describe('AC10: Back to sign in', () => {
  it('works from both steps without any request', async () => {
    const store = fakeStore(null);
    params.email = 'sam@example.com';
    setStore(store);
    await render(<ResetPasswordScreen />);
    await fireEvent.press(button('Back to sign in'));
    expect(router.back).toHaveBeenCalledTimes(1);
    await fireEvent.press(button('Send code'));
    await fireEvent.press(button('Back to sign in'));
    expect(router.back).toHaveBeenCalledTimes(2);
    expect(store.resetPasswordWithCode).not.toHaveBeenCalled();
  });
});
