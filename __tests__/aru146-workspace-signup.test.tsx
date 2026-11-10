// ARU-146: the Create account screen asks to create or join a workspace; Manage roles shows the teacher the
// workspace's name and invite code with Copy. Database rules: supabase/tests/aru146_workspace_signup.test.sql.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

import SignInScreen from '@/app/index';
import RolesScreen from '@/app/roles';
import { I18nContext, make } from '@/i18n/context';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const button = (name: string) => screen.getByRole('button', { name });
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;

async function openSignUp() {
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByText('Create account'));
  await fireEvent.changeText(screen.getByPlaceholderText('Dana Serikova'), 'Dana');
  await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'dana@example.com');
  await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
}

beforeEach(() => jest.clearAllMocks());

describe('AC 1: the choice', () => {
  it('below name, email and password; nothing chosen at first; Create account waits for a choice and its field', async () => {
    setStore(fakeStore(null));
    await openSignUp();
    const create = screen.getByRole('tab', { name: 'Create a workspace' });
    const join = screen.getByRole('tab', { name: 'Join a workspace' });
    expect(create.props.accessibilityState).toEqual({ selected: false });
    expect(join.props.accessibilityState).toEqual({ selected: false });
    expect(screen.queryByText('Workspace name')).toBeNull();
    expect(screen.queryByText('Invite code')).toBeNull();
    expect(button('Create account')).toBeDisabled();

    await fireEvent.press(create);
    expect(screen.getByText('Workspace name')).toBeTruthy();
    expect(button('Create account')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('My school'), '   ');
    expect(button('Create account')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('My school'), 'School');
    expect(button('Create account')).toBeEnabled();

    // Switching keeps the button right: the code field is empty.
    await fireEvent.press(join);
    expect(screen.queryByText('Workspace name')).toBeNull();
    expect(screen.getByText('Invite code')).toBeTruthy();
    expect(button('Create account')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('8 letters and digits'), '  ');
    expect(button('Create account')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('8 letters and digits'), 'abcd2345');
    expect(button('Create account')).toBeEnabled();
    await fireEvent.press(create);
    expect(button('Create account')).toBeEnabled(); // the name typed before is kept
  });

  it('AC 2: the workspace name takes at most 80 characters; the code is typed in capitals', async () => {
    setStore(fakeStore(null));
    await openSignUp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Create a workspace' }));
    expect(screen.getByPlaceholderText('My school').props.maxLength).toBe(80);
    await fireEvent.press(screen.getByRole('tab', { name: 'Join a workspace' }));
    expect(screen.getByPlaceholderText('8 letters and digits').props.autoCapitalize).toBe('characters');
  });

  it('sends the choice: create, or join with the code as typed', async () => {
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await openSignUp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Join a workspace' }));
    await fireEvent.changeText(screen.getByPlaceholderText('8 letters and digits'), ' abcd2345 ');
    await fireEvent.press(button('Create account'));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith('Dana', 'dana@example.com', 'secret1', { kind: 'join', code: ' abcd2345 ' }),
    );
  });

  it('AC 4: the wrong-code message shows in Russian', async () => {
    const signUp = jest.fn(async () => {
      throw new Error('No workspace has this invite code.');
    });
    setStore(fakeStore(null, { signUp }));
    await render(ru(<SignInScreen />));
    await fireEvent.press(screen.getByText('Регистрация'));
    await fireEvent.changeText(screen.getByPlaceholderText('Дана Серикова'), 'Аня');
    await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'a@b.c');
    await fireEvent.changeText(screen.getByPlaceholderText('Не менее 6 символов'), 'secret1');
    await fireEvent.press(screen.getByRole('tab', { name: 'Присоединиться' }));
    expect(screen.getByText('Код приглашения')).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('8 букв и цифр'), 'ZZZZZZZZ');
    await fireEvent.press(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(await screen.findByText('Нет рабочего пространства с этим кодом приглашения.')).toBeTruthy();
  });
});

describe('AC 8 / AC 9: the workspace card in Manage roles', () => {
  it('the teacher sees the name and code; Copy copies it and shows "Copied"', async () => {
    jest.useFakeTimers();
    const getWorkspaceInvite = jest.fn(async () => ({ name: 'Sham', code: 'ABCD2345' }));
    setStore(fakeStore('T', { getWorkspaceInvite }));
    await render(<RolesScreen />);
    expect(await screen.findByText('ABCD2345')).toBeTruthy();
    expect(screen.getByText('Sham')).toBeTruthy();
    expect(screen.queryByText('Copied')).toBeNull();
    await fireEvent.press(button('Copy invite code'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ABCD2345');
    expect(await screen.findByText('Copied')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(2100));
    expect(screen.queryByText('Copied')).toBeNull();
    jest.useRealTimers();
  });

  it('nothing when the database returns no code', async () => {
    setStore(fakeStore('T', { getWorkspaceInvite: jest.fn(async () => null) }));
    await render(<RolesScreen />);
    await act(async () => {});
    expect(screen.queryByTestId('workspace-card')).toBeNull();
  });

  it.each(['M', 'S1'] as const)('%s never asks for the code', async (who) => {
    const getWorkspaceInvite = jest.fn(async () => ({ name: 'Sham', code: 'ABCD2345' }));
    setStore(fakeStore(who, { getWorkspaceInvite }));
    await render(<RolesScreen />);
    await act(async () => {});
    expect(getWorkspaceInvite).not.toHaveBeenCalled();
    expect(screen.queryByText('ABCD2345')).toBeNull();
  });
});
