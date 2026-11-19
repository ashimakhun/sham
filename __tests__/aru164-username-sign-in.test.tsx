// ARU-164: sign-up and sign-in with a username and a display name (no email). The database side is covered by
// supabase/tests/aru164_username_sign_in.test.sql; the store's sign-up call by aru146-store-workspace-signup.test.tsx.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import SignInScreen from '@/app/index';
import { signInErrorMessage, signUpErrorMessage, USERNAME_INVALID_CREDENTIALS, USERNAME_TAKEN } from '@/lib/password';
import { isValidUsername, signInAddress, usernameAddress, usernameFromAddress, USERNAME_DOMAIN } from '@/lib/username';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

beforeEach(() => jest.clearAllMocks());

const RULE = '3–30 characters: letters a–z, digits, _ . -; starts and ends with a letter or digit';
const button = (name: string) => screen.getAllByRole('button', { name }).at(-1)!;

describe('username rules (AC 2)', () => {
  it.each(['ab', 'a'.repeat(31), 'dana s', 'dana@x', 'дана', '_dana', 'dana.', '-dana', 'da..na', ''])('%j is refused', (u) => {
    expect(isValidUsername(u)).toBe(false);
  });
  it.each(['abc', 'b'.repeat(30), 'dana_s', 'd.a-n_a', 'Dana_S', ' dana_s '])('%j is accepted', (u) => {
    expect(isValidUsername(u)).toBe(true);
  });
  it('the internal address is lower case on the .invalid domain', () => {
    expect(USERNAME_DOMAIN).toBe('users.sham.invalid');
    expect(usernameAddress(' Dana_S ')).toBe('dana_s@users.sham.invalid');
  });
});

describe('sign-in address (AC 6, AC 8, note 5)', () => {
  it('a username in any case becomes its internal address; no sign-up rules here', () => {
    expect(signInAddress('DANA_S')).toBe('dana_s@users.sham.invalid');
    expect(signInAddress(' x ')).toBe('x@users.sham.invalid');
  });
  it('text with "@" is an older account email, used as typed (trimmed)', () => {
    expect(signInAddress(' Dana@Example.com ')).toBe('Dana@Example.com');
  });
  it('the username behind an address, or nothing for a real email (AC 10)', () => {
    expect(usernameFromAddress('dana_s@users.sham.invalid')).toBe('dana_s');
    expect(usernameFromAddress('dana@example.com')).toBeNull();
    expect(usernameFromAddress(undefined)).toBeNull();
  });
});

describe('errors (AC 4, AC 7)', () => {
  it('wrong username or password reads the same, whatever was typed', () => {
    expect(signInErrorMessage({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' })).toBe(
      'Incorrect username or password.',
    );
    expect(USERNAME_INVALID_CREDENTIALS).toBe('Incorrect username or password.');
    expect(signInErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(/Could not reach the server/);
  });
  it('a used address on sign-up is a taken username', () => {
    expect(signUpErrorMessage({ code: 'user_already_exists', status: 422 }, 'create')).toBe(USERNAME_TAKEN);
    expect(USERNAME_TAKEN).toBe('This username is taken. Try another one.');
  });
});

describe('sign-in screen', () => {
  it('AC 1: Create account shows Display name (with its hint), Username and Password, no email', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Create account' }));
    expect(screen.getByText('Display name')).toBeTruthy();
    expect(screen.getByText("Doesn't have to be your real name")).toBeTruthy();
    expect(screen.getByText('Username')).toBeTruthy();
    expect(screen.queryByText('Email')).toBeNull();
    expect(screen.queryByText('Created your account with an email? Sign in with it.')).toBeNull();
  });

  it('AC 2: a broken username shows the rule and keeps Create account disabled; capitals are fine', async () => {
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Create account' }));
    await fireEvent.changeText(screen.getByPlaceholderText('Dana S.'), 'Dana');
    await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
    await fireEvent.press(screen.getByRole('tab', { name: 'Join a workspace' }));
    await fireEvent.changeText(screen.getByPlaceholderText('8 letters and digits'), 'ABCD2345');
    for (const bad of ['ab', 'da..na', '_dana', 'dana@x']) {
      await fireEvent.changeText(screen.getByTestId('username-field'), bad);
      expect(screen.getByText(RULE)).toBeTruthy();
      expect(button('Create account')).toBeDisabled();
    }
    await fireEvent.changeText(screen.getByTestId('username-field'), 'Dana_S');
    expect(screen.queryByText(RULE)).toBeNull();
    expect(button('Create account')).toBeEnabled();
    await fireEvent.press(button('Create account'));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith('Dana', 'Dana_S', 'secret1', { kind: 'join', code: 'ABCD2345' }));
  });

  it('AC 6, AC 8, AC 9: Sign in takes a username or an email, with the hint and no Forgot password?', async () => {
    const signIn = jest.fn(async () => {});
    setStore(fakeStore(null, { signIn }));
    await render(<SignInScreen />);
    const field = screen.getByTestId('username-field');
    expect(field.props.autoCapitalize).toBe('none');
    expect(field.props.autoCorrect).toBe(false);
    expect(field.props.autoComplete).toBe('username');
    expect(field.props.textContentType).toBe('username');
    expect(screen.getByText('Created your account with an email? Sign in with it.')).toBeTruthy();
    expect(screen.queryByText('Forgot password?')).toBeNull();
    await fireEvent.changeText(field, 'ab'); // no sign-up rules when signing in
    await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
    expect(screen.queryByText(RULE)).toBeNull();
    await fireEvent.press(button('Sign in'));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('ab', 'secret1'));
  });

  it('AC 7: the wrong-credentials text shows on the screen', async () => {
    const signIn = jest.fn(async () => {
      throw new Error('Incorrect username or password.');
    });
    setStore(fakeStore(null, { signIn }));
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('username-field'), 'dana_s');
    await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
    await fireEvent.press(button('Sign in'));
    expect(await screen.findByText('Incorrect username or password.')).toBeTruthy();
  });
});

describe('Profile (AC 10)', () => {
  const withEmail = (email: string) =>
    fakeStore('S1', { session: { user: { id: 'S1', email } } as never });

  it('a username account shows @username, never the address', async () => {
    setStore(withEmail('dana_s@users.sham.invalid'));
    await render(<ProfileScreen />);
    expect(screen.getByTestId('profile-username').props.children).toBe('@dana_s');
    expect(screen.queryByText(/users\.sham\.invalid/)).toBeNull();
  });

  it('an older account shows no username line and never its email', async () => {
    setStore(withEmail('old@example.com'));
    await render(<ProfileScreen />);
    expect(screen.queryByTestId('profile-username')).toBeNull();
    expect(screen.queryByText('old@example.com')).toBeNull();
  });

  it('Edit name says Display name', async () => {
    setStore(withEmail('dana_s@users.sham.invalid'));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Edit name' }));
    expect(screen.getByText('Display name')).toBeTruthy();
  });
});
