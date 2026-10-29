// ARU-20 QA additions to aru20-signup-hint.test.tsx, following the TEST DESIGN: the Create account button's
// disabled rules and "Please wait…" state, the error text above the button, nothing rendered after the button
// in either mode (no empty gap), Sign in unchanged, and the signed-in / profile-error screens (regression).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignInScreen from '@/app/index';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => ({
  ...require('./helpers/mocks').expoRouter,
  Redirect: ({ href }: { href: string }) => require('react').createElement(require('react-native').Text, null, `redirect:${href}`),
}));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const button = (name: string) => screen.getByRole('button', { name });
const fill = async (name: string, email: string, password: string) => {
  await fireEvent.changeText(screen.getByPlaceholderText('Dana Serikova'), name);
  await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), email);
  await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), password);
};
/** The last element in the form's scroll content must be the submit button: nothing (not even an empty Text) after it. */
const lastFormChild = (container: Awaited<ReturnType<typeof render>>['container']) => {
  const scroll = container.queryAll((n) => n.type === 'RCTScrollView')[0];
  const content = scroll.children[0] as typeof scroll;
  return content.children[content.children.length - 1] as typeof scroll;
};

beforeEach(() => jest.clearAllMocks());

describe('Create account mode', () => {
  it('AC2: the button is disabled without a name, without an email, or with a password under 6 characters', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByText('Create account'));
    await fill('', 'dana@example.com', 'secret1');
    expect(button('Create account')).toBeDisabled();
    await fill('   ', 'dana@example.com', 'secret1');
    expect(button('Create account')).toBeDisabled();
    await fill('Dana', '', 'secret1');
    expect(button('Create account')).toBeDisabled();
    await fill('Dana', 'dana@example.com', '12345');
    expect(button('Create account')).toBeDisabled();
    await fill('Dana', 'dana@example.com', '123456');
    expect(button('Create account')).toBeEnabled();
  });

  it('AC2: while signing up the button says "Please wait…" and is disabled', async () => {
    let finish!: () => void;
    const signUp = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setStore(fakeStore(null, { signUp }));
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByText('Create account'));
    await fill('Dana', 'dana@example.com', 'secret1');
    // Not awaited: the sign-up promise stays pending until finish() is called.
    void fireEvent.press(button('Create account'));
    expect(await screen.findByRole('button', { name: 'Please wait…' })).toBeDisabled();
    await act(async () => finish());
    expect(button('Create account')).toBeEnabled();
  });

  it('edge: a sign-up error (email already used) shows above the button, and still nothing below it', async () => {
    const signUp = jest.fn().mockRejectedValue(new Error('User already registered'));
    setStore(fakeStore(null, { signUp }));
    const { container } = await render(<SignInScreen />);
    await fireEvent.press(screen.getByText('Create account'));
    await fill('Dana', 'used@example.com', 'secret1');
    await fireEvent.press(button('Create account'));
    expect(await screen.findByText('User already registered')).toBeTruthy();
    expect(screen.queryByText(/New accounts start as students|mentor or teacher/)).toBeNull();
    expect(lastFormChild(container).props.accessibilityRole).toBe('button');
  });

  it('edge (no empty gap): the Create account button is the last element of the form', async () => {
    setStore(fakeStore(null));
    const { container } = await render(<SignInScreen />);
    await fireEvent.press(screen.getByText('Create account'));
    const last = lastFormChild(container);
    expect(last.props.accessibilityRole).toBe('button');
    expect(screen.getByRole('button', { name: 'Create account' })).toBe(last);
  });

  it('AC5: Create account mode shows only the expected texts, with no explanation of roles anywhere', async () => {
    setStore(fakeStore(null));
    const { container } = await render(<SignInScreen />);
    await fireEvent.press(screen.getByText('Create account'));
    const texts = container
      .queryAll((n) => n.type === 'Text')
      .map((n) => [n.props.children].flat().join(''))
      .filter((t) => t.trim());
    expect(texts).toEqual([
      'Sham',
      'Homework, checks and lessons in one place.',
      'Sign in',
      'Create account',
      'Full name',
      'Email',
      'Password',
      'Create account',
    ]);
  });
});

describe('Sign in mode (AC 3, regression)', () => {
  it('shows no Full name field and nothing below the Sign in button, and still signs in', async () => {
    const signIn = jest.fn(async () => {});
    setStore(fakeStore(null, { signIn }));
    const { container } = await render(<SignInScreen />);
    expect(screen.queryByText('Full name')).toBeNull();
    expect(lastFormChild(container)).toBe(screen.getByRole('button', { name: 'Sign in' }));
    await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'dana@example.com');
    await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
    await fireEvent.press(button('Sign in'));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('dana@example.com', 'secret1'));
  });
});

describe('Regression: other start-screen states', () => {
  it('a signed-in user is redirected to Homework', async () => {
    setStore(fakeStore('S1'));
    await render(<SignInScreen />);
    expect(screen.getByText('redirect:/homework')).toBeTruthy();
  });

  it('signed in without a profile shows "Could not load your profile." with Try again and Sign out', async () => {
    setStore(fakeStore(null, { session: { user: { id: 'x' } } as never, dataLoaded: true, users: [users.S1] }));
    await render(<SignInScreen />);
    expect(screen.getByText('Could not load your profile.')).toBeTruthy();
    expect(button('Try again')).toBeTruthy();
    expect(button('Sign out')).toBeTruthy();
  });
});
