// ARU-76: a signed-in user changes their own password from Profile. Screen behaviour with a fake store; the store's
// changePassword() (checks the current password first, then updates) is tested in aru76-store-change-password.test.tsx.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router, usePreventRemove } from 'expo-router';
import { Alert } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import ChangePasswordScreen from '@/app/change-password';
import { AccessGate } from '@/components/AccessGate';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const isDisabled = (name: string | RegExp) => !!button(name).props.accessibilityState?.disabled;
const input = (id: string) => screen.getByTestId(id);

async function fill(current: string, next: string, confirm = next) {
  await fireEvent.changeText(input('current-password'), current);
  await fireEvent.changeText(input('new-password'), next);
  await fireEvent.changeText(input('confirm-password'), confirm);
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('AC1: Change password on Profile', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees it in the bottom group, above Sign out, and it opens the form', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    const buttons = screen.getAllByRole('button');
    const at = (name: string | RegExp) => buttons.indexOf(screen.getByRole('button', { name }));
    expect(at('Change password')).toBeGreaterThan(at('Open general chat'));
    expect(at('Change password')).toBe(at('Sign out') - 1);
    if (who === 'T') expect(at('Change password')).toBeGreaterThan(at(/^Manage roles/));
    await fireEvent.press(button('Change password'));
    expect(router.push).toHaveBeenCalledWith('/change-password');
  });

  it.each(['pending', 'rejected'] as const)('a %s account sees only the access screen, no Change password', async (status) => {
    setStore(fakeStore('S1', { currentUser: { ...users.S1, accessStatus: status } }));
    await render(
      <AccessGate>
        <ProfileScreen />
      </AccessGate>,
    );
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
  });
});

describe('AC2–AC3: the form', () => {
  it('has three hidden fields with the right autofill hints, Save and Cancel', async () => {
    setStore(fakeStore('S1'));
    await render(<ChangePasswordScreen />);
    for (const id of ['current-password', 'new-password', 'confirm-password']) expect(input(id).props.secureTextEntry).toBe(true);
    expect(input('current-password').props.autoComplete).toBe('current-password');
    expect(input('new-password').props.autoComplete).toBe('new-password');
    expect(input('confirm-password').props.autoComplete).toBe('new-password');
    expect(input('new-password').props.placeholder).toBe('At least 6 characters');
    for (const label of ['Current password', 'New password', 'Confirm new password']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByTestId('keyboard-form')).toBeTruthy(); // AC 11 (ARU-58/59 container)
    await fireEvent.press(button('Cancel'));
    expect(router.back).toHaveBeenCalled();
  });

  it('Save stays disabled until every field is filled, the new password has 6+ characters and both match', async () => {
    setStore(fakeStore('S1'));
    await render(<ChangePasswordScreen />);
    expect(isDisabled('Save')).toBe(true);
    await fill('', 'secret6');
    expect(isDisabled('Save')).toBe(true);
    await fill('oldpass', 'short');
    expect(isDisabled('Save')).toBe(true);
    await fill('oldpass', 'secret6', 'secret7');
    expect(isDisabled('Save')).toBe(true);
    expect(screen.getByText("Passwords don't match")).toBeTruthy();
    await fill('oldpass', 'secret6');
    expect(isDisabled('Save')).toBe(false);
    expect(screen.queryByText("Passwords don't match")).toBeNull();
  });

  it('shows "Passwords don\'t match" only when both new fields are filled', async () => {
    setStore(fakeStore('S1'));
    await render(<ChangePasswordScreen />);
    await fireEvent.changeText(input('new-password'), 'secret6');
    expect(screen.queryByText("Passwords don't match")).toBeNull();
    await fireEvent.changeText(input('confirm-password'), 'secret');
    expect(screen.getByText("Passwords don't match")).toBeTruthy();
  });
});

describe('AC4–AC9: saving', () => {
  it('AC6: success calls changePassword once, shows "Password changed" and goes back to Profile', async () => {
    const changePassword = jest.fn(async () => {});
    setStore(fakeStore('M', { changePassword }));
    await render(<ChangePasswordScreen />);
    await fill(' old pass ', ' new pass ');
    await fireEvent.press(button('Save'));
    expect(changePassword).toHaveBeenCalledTimes(1);
    expect(changePassword).toHaveBeenCalledWith(' old pass ', ' new pass '); // never trimmed
    expect(alertSpy).toHaveBeenCalledWith('Password changed', undefined);
    expect(router.back).toHaveBeenCalled();
  });

  it.each([
    'The new password must be different from the current one',
    'Current password is incorrect',
    'Password should be at least 8 characters.',
    'Could not reach the server. Check your connection and try again.',
  ])('shows "%s", keeps the fields and stays open; Save retries', async (message) => {
    const changePassword = jest.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(undefined);
    setStore(fakeStore('T', { changePassword }));
    await render(<ChangePasswordScreen />);
    await fill('oldpass', 'secret6');
    await fireEvent.press(button('Save'));
    expect(screen.getByText(message)).toBeTruthy();
    expect(input('current-password').props.value).toBe('oldpass');
    expect(input('new-password').props.value).toBe('secret6');
    expect(input('confirm-password').props.value).toBe('secret6');
    expect(router.back).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    await fireEvent.press(button('Save'));
    expect(changePassword).toHaveBeenCalledTimes(2);
    expect(router.back).toHaveBeenCalled();
  });
});

describe('AC10: one request per tap, no leaving while saving', () => {
  it('shows "Saving…", ignores a second tap and blocks back until the request ends', async () => {
    let finish!: () => void;
    const changePassword = jest.fn(() => new Promise<void>((r) => (finish = r)));
    setStore(fakeStore('S1', { changePassword }));
    await render(<ChangePasswordScreen />);
    await fill('oldpass', 'secret6');
    await fireEvent.press(button('Save'));
    await fireEvent.press(button('Saving…'));
    expect(changePassword).toHaveBeenCalledTimes(1);
    expect(isDisabled('Saving…')).toBe(true);
    expect(isDisabled('Cancel')).toBe(true);
    const prevent = jest.mocked(usePreventRemove);
    expect(prevent.mock.calls.at(-1)?.[0]).toBe(true);
    await act(async () => finish());
    expect(prevent.mock.calls.at(-1)?.[0]).toBe(false);
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
