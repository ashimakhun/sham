// ARU-165: Save your recovery code (AC 1–4), Profile → Recovery code (AC 5–7), Forgot password (AC 8–12), the old
// reset link (AC 13) and the texts (AC 14).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { router, Redirect } from 'expo-router';
import { BackHandler, Text } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import ForgotPasswordScreen from '@/app/forgot-password';
import SignInScreen from '@/app/index';
import NewRecoveryCodeScreen from '@/app/recovery-code';
import OldResetPasswordLink from '@/app/reset-password';
import { AccessGate, WAITING_TITLE } from '@/components/AccessGate';
import { CHOOSE_USERNAME_TITLE } from '@/components/ChooseUsernameScreen';
import { SAVE_RECOVERY_TEXT, SAVE_RECOVERY_TITLE } from '@/components/RecoveryCode';
import en from '@/i18n/en.json';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';
import { cleanRecoveryCode, RecoveryCodeReplaced, recoveryCodeReady } from '@/lib/recovery';

import { fakeStore, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const CODE = 'ABCD-EFGH-JKMN-PQRS';
const button = (name: string | RegExp) => screen.getByRole('button', { name });

function app() {
  return render(
    <AccessGate>
      <Text>Tabs</Text>
    </AccessGate>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  delete (params as Record<string, unknown>).username;
});

describe('AC 1: the Save your recovery code gate', () => {
  it.each(['T', 'M', 'S1'] as const)('%s with a username and no saved code sees only the Save screen', async (who) => {
    setStore(fakeStore(who, { myUsername: 'sam', needsRecoveryCode: true }));
    await app();
    expect(screen.getByText(SAVE_RECOVERY_TITLE)).toBeTruthy();
    expect(SAVE_RECOVERY_TEXT).toBe(
      "If you forget your password, this code is the only way to set a new one yourself. Keep it somewhere safe outside Sham. It's shown only now.",
    );
    expect(screen.getByText(SAVE_RECOVERY_TEXT)).toBeTruthy();
    expect(await screen.findByText(CODE)).toBeTruthy();
    expect(screen.queryByText('Tabs')).toBeNull();
    expect(screen.queryByText(/^Back$|^Skip$/)).toBeNull();
  });

  it('comes after Choose a username and before the waiting screen', async () => {
    const pending = { ...users.S1, accessStatus: 'pending' as const };
    setStore(fakeStore(null, { currentUser: pending, needsUsername: true, myUsername: null, needsRecoveryCode: false }));
    const view = await app();
    expect(screen.getByText(CHOOSE_USERNAME_TITLE)).toBeTruthy();
    setStore(fakeStore(null, { currentUser: pending, myUsername: 'sam', needsRecoveryCode: true }));
    await view.rerender(
      <AccessGate>
        <Text>Tabs</Text>
      </AccessGate>,
    );
    expect(screen.getByText(SAVE_RECOVERY_TITLE)).toBeTruthy();
    expect(screen.queryByText(WAITING_TITLE)).toBeNull();
  });

  it('the code is selectable; Android back does nothing; Sign out works', async () => {
    const add = jest.spyOn(BackHandler, 'addEventListener');
    const store = fakeStore('S1', { myUsername: 'sam', needsRecoveryCode: true });
    setStore(store);
    await app();
    const code = await screen.findByTestId('recovery-code');
    expect(code.props.selectable).toBe(true);
    const handler = add.mock.calls.find((c) => c[0] === 'hardwareBackPress')?.[1] as () => boolean;
    expect(handler()).toBe(true);
    await fireEvent.press(button('Sign out'));
    expect(store.signOut).toHaveBeenCalled();
  });

  it('AC 2: Copy puts the code with dashes on the clipboard and shows Copied', async () => {
    setStore(fakeStore('S1', { myUsername: 'sam', needsRecoveryCode: true }));
    await app();
    await screen.findByText(CODE);
    await fireEvent.press(button('Copy the recovery code'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(CODE);
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('AC 3: Continue is enabled only with the switch on and saves the code shown', async () => {
    const store = fakeStore('S1', { myUsername: 'sam', needsRecoveryCode: true });
    setStore(store);
    await app();
    await screen.findByText(CODE);
    expect(button('Continue')).toBeDisabled();
    await fireEvent(screen.getByTestId('recovery-saved-switch'), 'valueChange', true);
    expect(button('Continue')).toBeEnabled();
    await fireEvent.press(button('Continue'));
    await waitFor(() => expect(store.saveRecoveryCode).toHaveBeenCalledWith(CODE));
  });

  it('AC 4: offline on Continue shows the error and keeps the same code', async () => {
    const saveRecoveryCode = jest.fn(async () => {
      throw new Error('Could not reach the server. Check your connection and try again.');
    });
    setStore(fakeStore('S1', { myUsername: 'sam', needsRecoveryCode: true, saveRecoveryCode }));
    await app();
    await screen.findByText(CODE);
    await fireEvent(screen.getByTestId('recovery-saved-switch'), 'valueChange', true);
    await fireEvent.press(button('Continue'));
    expect(await screen.findByText('Could not reach the server. Check your connection and try again.')).toBeTruthy();
    expect(screen.getByText(CODE)).toBeTruthy();
    expect(button('Continue')).toBeEnabled();
  });

  it('edge case (two devices): Continue on an older code shows a fresh one with a message', async () => {
    const saveRecoveryCode = jest.fn(async () => {
      throw new RecoveryCodeReplaced('WXYZ-2345-6789-ABCD');
    });
    setStore(fakeStore('S1', { myUsername: 'sam', needsRecoveryCode: true, saveRecoveryCode }));
    await app();
    await screen.findByText(CODE);
    await fireEvent(screen.getByTestId('recovery-saved-switch'), 'valueChange', true);
    await fireEvent.press(button('Continue'));
    expect(await screen.findByText('WXYZ-2345-6789-ABCD')).toBeTruthy();
    expect(screen.getByText(en['recovery.replaced'])).toBeTruthy();
    expect(button('Continue')).toBeDisabled();
  });

  it('a code that couldn\'t be made shows Try again', async () => {
    const getRecoveryCode = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(CODE);
    setStore(fakeStore('S1', { myUsername: 'sam', needsRecoveryCode: true, getRecoveryCode }));
    await app();
    expect(await screen.findByText("Couldn't make your recovery code.")).toBeTruthy();
    await fireEvent.press(button('Try again'));
    expect(await screen.findByText(CODE)).toBeTruthy();
  });
});

describe('AC 5–7: Profile → Recovery code', () => {
  it.each(['T', 'M', 'S1'] as const)('%s has Recovery code right under Change password', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    const all = screen.getAllByRole('button');
    expect(all.indexOf(button('Recovery code'))).toBe(all.indexOf(button('Change password')) + 1);
    await fireEvent.press(button('Recovery code'));
    expect(router.push).toHaveBeenCalledWith('/recovery-code');
  });

  it('AC 6: a wrong password shows the existing message', async () => {
    const makeNewRecoveryCode = jest.fn(async () => {
      throw new Error('Current password is incorrect');
    });
    setStore(fakeStore('S1', { makeNewRecoveryCode }));
    await render(<NewRecoveryCodeScreen />);
    expect(screen.getByText('Your current code will stop working.')).toBeTruthy();
    expect(button('Make a new code')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('recovery-current-password'), 'nope');
    await fireEvent.press(button('Make a new code'));
    expect(await screen.findByText('Current password is incorrect')).toBeTruthy();
    expect(makeNewRecoveryCode).toHaveBeenCalledWith('nope');
    expect(screen.queryByTestId('recovery-code')).toBeNull();
  });

  it('AC 7: the right password shows the new code with Copy, I saved it and Done', async () => {
    const store = fakeStore('S1');
    setStore(store);
    await render(<NewRecoveryCodeScreen />);
    await fireEvent.changeText(screen.getByTestId('recovery-current-password'), 'secret1');
    await fireEvent.press(button('Make a new code'));
    expect(await screen.findByText('WXYZ-2345-6789-ABCD')).toBeTruthy();
    expect(button('Copy the recovery code')).toBeTruthy();
    expect(button('Done')).toBeDisabled();
    await fireEvent(screen.getByTestId('recovery-saved-switch'), 'valueChange', true);
    await fireEvent.press(button('Done'));
    await waitFor(() => expect(store.saveRecoveryCode).toHaveBeenCalledWith('WXYZ-2345-6789-ABCD'));
    expect(router.back).toHaveBeenCalled();
  });
});

describe('AC 8–12: Forgot password', () => {
  it('AC 8: shown on the sign-in screen, carrying the username', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('username-field'), ' Dana_S ');
    await fireEvent.press(screen.getByText('Forgot password?'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/forgot-password', params: { username: 'Dana_S' } });
  });

  it('AC 8: the username is filled in; same field settings as sign-in; code field without autocorrect', async () => {
    (params as Record<string, unknown>).username = 'dana_s';
    setStore(fakeStore(null));
    await render(<ForgotPasswordScreen />);
    const user = screen.getByTestId('forgot-username');
    expect(user.props.value).toBe('dana_s');
    expect(user.props.autoCapitalize).toBe('none');
    expect(user.props.autoCorrect).toBe(false);
    expect(user.props.autoComplete).toBe('username');
    const code = screen.getByTestId('forgot-code');
    expect(code.props.autoCorrect).toBe(false);
    expect(code.props.autoCapitalize).toBe('none');
  });

  it('AC 8: Set new password is enabled only with a username, 16 valid characters and a ready password', async () => {
    const store = fakeStore(null);
    setStore(store);
    await render(<ForgotPasswordScreen />);
    const submit = () => button('Set new password');
    await fireEvent.changeText(screen.getByTestId('new-password'), 'secret1');
    await fireEvent.changeText(screen.getByTestId('confirm-password'), 'secret1');
    await fireEvent.changeText(screen.getByTestId('forgot-code'), CODE);
    expect(submit()).toBeDisabled(); // blank username
    await fireEvent.changeText(screen.getByTestId('forgot-username'), 'sam');
    expect(submit()).toBeEnabled();
    for (const bad of ['ABCD-EFGH-JKMN-PQR', 'ABCD-EFGH-JKMN-PQRST', 'ABCD-EFGH-JKMN-PQR0', 'OBCD-EFGH-JKMN-PQRS', 'IBCD-EFGH-JKMN-PQRS', 'LBCD-EFGH-JKMN-PQRS', '1BCD-EFGH-JKMN-PQRS']) {
      await fireEvent.changeText(screen.getByTestId('forgot-code'), bad);
      expect(submit()).toBeDisabled();
    }
    await fireEvent.changeText(screen.getByTestId('forgot-code'), 'abcd efgh jkmnpqrs\n');
    expect(submit()).toBeEnabled();
    await fireEvent.changeText(screen.getByTestId('confirm-password'), 'secret2');
    expect(submit()).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('confirm-password'), 'secret1');
    await fireEvent.press(submit());
    await waitFor(() => expect(store.recoverPassword).toHaveBeenCalledWith('sam', 'abcd efgh jkmnpqrs\n', 'secret1'));
    // AC 9: back to the root, which opens the app (Save screen first).
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it.each([
    ['AC 10', 'Incorrect username or recovery code.'],
    ['AC 11', 'Too many attempts. Try again in 15 minutes.'],
    ['AC 12', 'The password is too weak. Use at least 8 characters.'],
    ['AC 12 offline', 'Could not reach the server. Check your connection and try again.'],
  ])('%s: the error shows and the screen stays', async (_, text) => {
    const recoverPassword = jest.fn(async () => {
      throw new Error(text);
    });
    setStore(fakeStore(null, { recoverPassword }));
    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('forgot-username'), 'sam');
    await fireEvent.changeText(screen.getByTestId('forgot-code'), CODE);
    await fireEvent.changeText(screen.getByTestId('new-password'), 'secret1');
    await fireEvent.changeText(screen.getByTestId('confirm-password'), 'secret1');
    await fireEvent.press(button('Set new password'));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('AC 9: the sign-in screen shows the password-changed notice', async () => {
    setStore(fakeStore(null, { accountNotice: 'You were signed out because your password was changed.' }));
    await render(<SignInScreen />);
    expect(screen.getByTestId('account-notice')).toHaveTextContent('You were signed out because your password was changed.');
  });
});

describe('AC 13: the email reset is gone', () => {
  it('the old /reset-password link redirects to the root', async () => {
    await act(async () => {
      render(<OldResetPasswordLink />);
    });
    expect((Redirect as unknown as jest.Mock).mock.calls[0][0]).toEqual({ href: '/' });
  });

  it('no catalog text about email resets is left', () => {
    for (const id of Object.keys(en)) expect(id).not.toMatch(/^reset\./);
    expect(en).not.toHaveProperty('auth.codeInvalid');
    expect(en).not.toHaveProperty('auth.emailNotConfirmed');
  });
});

describe('AC 14 and helpers', () => {
  it('every new text is in English, Russian and notes', () => {
    const ids = Object.keys(en).filter((k) => /^(recovery|forgot)\./.test(k)).concat('signIn.passwordChangedSignedOut');
    expect(ids.length).toBeGreaterThan(15);
    for (const id of ids) {
      expect((ru as Record<string, string>)[id]).toBeTruthy();
      expect((notes as Record<string, string>)[id]).toBeTruthy();
    }
  });

  it('codes: case, spaces, dashes and a trailing newline don\'t matter; the alphabet has no 0 O 1 I L', () => {
    expect(cleanRecoveryCode(' abcd-efgh jkmn-pqrs\n')).toBe('ABCDEFGHJKMNPQRS');
    expect(recoveryCodeReady('abcdefghjkmnpqrs')).toBe(true);
    expect(recoveryCodeReady('abcdefghjkmnpqr')).toBe(false);
    expect(recoveryCodeReady('abcdefghjkmnpqrO')).toBe(false);
  });
});
