// ARU-146: workspaces, part 2 (app side). The Create account choice (create a workspace or join one with its invite
// code), the error texts, and the invite card on Manage roles. The database rules are tested in
// supabase/tests/aru146_workspace_signup.test.sql; the store's sign-up in aru146-store-signup.test.tsx.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

import SignInScreen from '@/app/index';
import RolesScreen from '@/app/roles';
import { dbErrorMessage, translateMessage } from '@/i18n';
import { INVITE_CODE_UNKNOWN } from '@/lib/password';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const button = (name: string) => screen.getByRole('button', { name });
async function openCreateAccount(signUp = jest.fn(async () => {})) {
  setStore(fakeStore(null, { signUp }));
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByText('Create account'));
  await fireEvent.changeText(screen.getByPlaceholderText('Dana Serikova'), 'Dana');
  await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'dana@example.com');
  await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
  return signUp;
}

beforeEach(() => jest.clearAllMocks());

describe('AC 1: the choice on Create account', () => {
  it('shows both options below name, email and password, and no field until one is chosen', async () => {
    await openCreateAccount();
    expect(screen.getByRole('radio', { name: 'Create a workspace' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Join a workspace' })).toBeTruthy();
    expect(screen.queryByText('Workspace name')).toBeNull();
    expect(screen.queryByText('Invite code')).toBeNull();
    expect(button('Create account')).toBeDisabled();
  });

  it('Create account stays disabled until the chosen field has something other than spaces', async () => {
    await openCreateAccount();
    await fireEvent.press(screen.getByRole('radio', { name: 'Create a workspace' }));
    expect(screen.getByRole('radio', { name: 'Create a workspace' }).props.accessibilityState).toEqual({ checked: true });
    expect(button('Create account')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('My school'), '   ');
    expect(button('Create account')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('My school'), 'My school');
    expect(button('Create account')).toBeEnabled();
    // Switching to Join: its own (empty) field decides.
    await fireEvent.press(screen.getByRole('radio', { name: 'Join a workspace' }));
    expect(screen.queryByText('Workspace name')).toBeNull();
    expect(button('Create account')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('8 characters from your teacher'), ' ');
    expect(button('Create account')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('8 characters from your teacher'), 'abcd2345');
    expect(button('Create account')).toBeEnabled();
  });

  it('Sign in mode shows no choice', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('AC 2 / AC 3: what sign-up sends', () => {
  it('Create a workspace sends the name, and the field is capped at 80 characters', async () => {
    const signUp = await openCreateAccount();
    await fireEvent.press(screen.getByRole('radio', { name: 'Create a workspace' }));
    expect(screen.getByPlaceholderText('My school').props.maxLength).toBe(80);
    await fireEvent.changeText(screen.getByPlaceholderText('My school'), '  My school ');
    await fireEvent.press(button('Create account'));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith('Dana', 'dana@example.com', 'secret1', { kind: 'create', name: '  My school ' }),
    );
  });

  it('Join a workspace sends the code', async () => {
    const signUp = await openCreateAccount();
    await fireEvent.press(screen.getByRole('radio', { name: 'Join a workspace' }));
    await fireEvent.changeText(screen.getByPlaceholderText('8 characters from your teacher'), 'abcd2345');
    await fireEvent.press(button('Create account'));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith('Dana', 'dana@example.com', 'secret1', { kind: 'join', code: 'abcd2345' }),
    );
  });

  it('AC 4: a wrong code shows "No workspace has this invite code"', async () => {
    await openCreateAccount(jest.fn().mockRejectedValue(new Error(INVITE_CODE_UNKNOWN)));
    await fireEvent.press(screen.getByRole('radio', { name: 'Join a workspace' }));
    await fireEvent.changeText(screen.getByPlaceholderText('8 characters from your teacher'), 'ZZZZZZZZ');
    await fireEvent.press(button('Create account'));
    expect(await screen.findByText('No workspace has this invite code')).toBeTruthy();
  });

  it('AC 4 / AC 5: the new messages are in Russian too', () => {
    expect(translateMessage('ru', 'No workspace has this invite code')).toBe('Нет рабочего пространства с этим кодом приглашения');
    // The database's own texts, by their sham: hint (ARU-111).
    expect(dbErrorMessage({ message: 'Update the app to create an account', hint: 'sham:update_app' }, 'ru')).toBe(
      'Обновите приложение, чтобы создать аккаунт',
    );
    expect(dbErrorMessage({ message: 'No workspace has this invite code', hint: 'sham:invite_code_unknown' }, 'ru')).toBe(
      'Нет рабочего пространства с этим кодом приглашения',
    );
  });
});

describe('AC 8 / AC 9: the invite card on Manage roles', () => {
  it('the teacher sees the workspace name and code, and Copy copies it and shows "Copied"', async () => {
    jest.useFakeTimers();
    setStore(fakeStore('T', { workspaceInvite: { name: 'Sham', inviteCode: 'ABCD2345' } }));
    await render(<RolesScreen />);
    expect(screen.getByText('Sham')).toBeTruthy();
    expect(screen.getByTestId('invite-code').props.children).toBe('ABCD2345');
    await fireEvent.press(screen.getByRole('button', { name: 'Copy invite code ABCD2345' }));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ABCD2345'));
    expect(await screen.findByText('Copied')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(2100));
    expect(screen.queryByText('Copied')).toBeNull();
    expect(screen.getByText('Copy')).toBeTruthy();
    jest.useRealTimers();
  });

  it('no card without an invite (the store loads it for the teacher only)', async () => {
    setStore(fakeStore('T'));
    await render(<RolesScreen />);
    expect(screen.queryByTestId('workspace-invite')).toBeNull();
  });
});
