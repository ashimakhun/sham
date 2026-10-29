// ARU-20: the Create account screen no longer promises role changes the app can't make.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignInScreen from '@/app/index';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HINT = /New accounts start as students|make you a mentor or teacher/;
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => jest.clearAllMocks());

it('AC1/AC5: Create account mode shows no hint under the button, even with all fields filled', async () => {
  setStore(fakeStore(null));
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByText('Create account'));
  expect(screen.queryByText(HINT)).toBeNull();
  await fireEvent.changeText(screen.getByPlaceholderText('Dana Serikova'), 'Dana');
  await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'dana@example.com');
  await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
  expect(button('Create account')).toBeEnabled();
  expect(screen.queryByText(HINT)).toBeNull();
});

it('AC2: the rest of Create account mode is unchanged', async () => {
  setStore(fakeStore(null));
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByText('Create account'));
  expect(screen.getByText('Sham')).toBeTruthy();
  expect(screen.getByText('Homework, checks and lessons in one place.')).toBeTruthy();
  expect(screen.getByText('Full name')).toBeTruthy();
  expect(screen.getByText('Email')).toBeTruthy();
  expect(screen.getByText('Password')).toBeTruthy();
  expect(button('Create account')).toBeDisabled();
});

it('AC3: toggling Sign in and Create account leaves no text under either button', async () => {
  setStore(fakeStore(null));
  await render(<SignInScreen />);
  for (const mode of ['Create account', 'Sign in', 'Create account', 'Sign in']) {
    await fireEvent.press(screen.getAllByText(mode)[0]);
    expect(screen.queryByText(HINT)).toBeNull();
  }
  expect(screen.queryByText('Full name')).toBeNull();
});

it('AC4: sign-up still calls signUp with the entered details', async () => {
  const signUp = jest.fn(async () => {});
  setStore(fakeStore(null, { signUp }));
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByText('Create account'));
  await fireEvent.changeText(screen.getByPlaceholderText('Dana Serikova'), 'Dana');
  await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'dana@example.com');
  await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
  await fireEvent.press(button('Create account'));
  await waitFor(() => expect(signUp).toHaveBeenCalledWith('Dana', 'dana@example.com', 'secret1'));
});
