// ARU-168: older accounts (no username) see Choose a username before anything else (AC 1), with the display name
// prefilled unless it looks like an email (AC 2); Save is enabled only for valid fields and calls chooseUsername (AC 3);
// errors show and nothing else happens (AC 4); texts in English and Russian (AC 10).
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AccessGate, WAITING_TITLE } from '@/components/AccessGate';
import { CHOOSE_USERNAME_TEXT, CHOOSE_USERNAME_TITLE, prefillDisplayName } from '@/components/ChooseUsernameScreen';
import { ProfileNameCard } from '@/components/ProfileNameCard';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

function app() {
  return render(
    <AccessGate>
      <Text>Tabs</Text>
    </AccessGate>,
  );
}

describe('AC 1: the gate', () => {
  it.each(['T', 'M', 'S1'] as const)('an older %s account sees only Choose a username', async (who) => {
    setStore(fakeStore(who, { needsUsername: true, myUsername: null }));
    await app();
    expect(screen.getByText(CHOOSE_USERNAME_TITLE)).toBeTruthy();
    expect(screen.getByText(CHOOSE_USERNAME_TEXT)).toBeTruthy();
    expect(CHOOSE_USERNAME_TEXT).toBe(
      'Sham no longer keeps email addresses. Choose a username to sign in with from now on. Your email will then be deleted.',
    );
    expect(screen.queryByText('Tabs')).toBeNull();
  });

  it('comes before the waiting screen', async () => {
    setStore(fakeStore(null, { currentUser: { ...users.S1, accessStatus: 'pending' }, needsUsername: true, myUsername: null }));
    await app();
    expect(screen.getByText(CHOOSE_USERNAME_TITLE)).toBeTruthy();
    expect(screen.queryByText(WAITING_TITLE)).toBeNull();
  });

  it('an account with a username never sees it (the waiting screen then shows as usual)', async () => {
    setStore(fakeStore(null, { currentUser: { ...users.S1, accessStatus: 'pending' }, myUsername: 'sam' }));
    await app();
    expect(screen.queryByText(CHOOSE_USERNAME_TITLE)).toBeNull();
    expect(screen.getByText(WAITING_TITLE)).toBeTruthy();
  });

  it('Sign out works', async () => {
    const store = fakeStore('S1', { needsUsername: true, myUsername: null });
    setStore(store);
    await app();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(store.signOut).toHaveBeenCalled();
  });
});

describe('AC 2: fields', () => {
  it('prefills the name unless it contains @', () => {
    expect(prefillDisplayName('Dana')).toBe('Dana');
    expect(prefillDisplayName('x@y.com')).toBe('');
    expect(prefillDisplayName(undefined)).toBe('');
  });

  it('the field shows the prefilled name, and the username field is set up like part 1', async () => {
    setStore(fakeStore(null, { currentUser: { ...users.S1, name: 'Dana' }, needsUsername: true, myUsername: null }));
    await app();
    expect(screen.getByTestId('choose-display-name-field').props.value).toBe('Dana');
    const field = screen.getByTestId('choose-username-field');
    expect(field.props.autoCapitalize).toBe('none');
    expect(field.props.autoComplete).toBe('username');
    expect(field.props.autoCorrect).toBe(false);
  });

  it('an email-like name leaves the field empty', async () => {
    setStore(fakeStore(null, { currentUser: { ...users.S1, name: 'x@y.com' }, needsUsername: true, myUsername: null }));
    await app();
    expect(screen.getByTestId('choose-display-name-field').props.value).toBe('');
  });

  const save = () => screen.getByText('Save');
  const disabled = () => !!screen.getByRole('button', { name: 'Save' }).props.accessibilityState?.disabled;

  it.each([
    ['an invalid username', 'a', 'Dana', true],
    ['an empty name', 'dana_s', '   ', true],
    ['81 characters', 'dana_s', 'x'.repeat(81), true],
    ['valid values with capitals', 'Dana_S', 'Dana', false],
    ['an @ typed in the name', 'dana_s', 'Dana @ home', false],
  ])('Save with %s: disabled = %s', async (_case, uname, name, off) => {
    setStore(fakeStore('S1', { needsUsername: true, myUsername: null }));
    await app();
    await fireEvent.changeText(screen.getByTestId('choose-username-field'), uname);
    await fireEvent.changeText(screen.getByTestId('choose-display-name-field'), name);
    expect(save()).toBeTruthy();
    expect(disabled()).toBe(off);
  });

  it('shows part 1\'s rule for a broken username', async () => {
    setStore(fakeStore('S1', { needsUsername: true, myUsername: null }));
    await app();
    await fireEvent.changeText(screen.getByTestId('choose-username-field'), 'a..b');
    expect(screen.getByTestId('choose-username-rule')).toBeTruthy();
  });
});

describe('AC 3 / AC 4: Save', () => {
  it('calls chooseUsername with the typed values', async () => {
    const store = fakeStore('S1', { needsUsername: true, myUsername: null });
    setStore(store);
    await app();
    await fireEvent.changeText(screen.getByTestId('choose-username-field'), 'Dana_S');
    await fireEvent.changeText(screen.getByTestId('choose-display-name-field'), 'Dana');
    await fireEvent.press(screen.getByText('Save'));
    expect(store.chooseUsername).toHaveBeenCalledWith('Dana_S', 'Dana');
  });

  it('a taken username shows part 1\'s text', async () => {
    const store = fakeStore('S1', {
      needsUsername: true,
      myUsername: null,
      chooseUsername: jest.fn(async () => {
        throw new Error('This username is taken. Try another one.');
      }),
    });
    setStore(store);
    await app();
    await fireEvent.changeText(screen.getByTestId('choose-username-field'), 'taken');
    await fireEvent.changeText(screen.getByTestId('choose-display-name-field'), 'Dana');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('This username is taken. Try another one.')).toBeTruthy();
    expect(screen.getByText(CHOOSE_USERNAME_TITLE)).toBeTruthy();
  });
});

describe('AC 9: Profile shows the own username row first', () => {
  it('a moved account whose session still has the old email', async () => {
    setStore(
      fakeStore('S1', {
        myUsername: 'user-ab12cd',
        session: { user: { id: 'S1', email: 'old@x.test' } } as never,
      }),
    );
    await render(<ProfileNameCard />);
    expect(screen.getByTestId('profile-username').props.children).toBe('@user-ab12cd');
  });
});

describe('AC 10: texts', () => {
  it.each(['chooseUsername.title', 'chooseUsername.text', 'chooseUsername.usernameA11y', 'chooseUsername.displayNameA11y', 'db.username_already_set'])(
    '%s is in English and Russian',
    (key) => {
      expect((en as Record<string, string>)[key]).toBeTruthy();
      expect((ru as Record<string, string>)[key]).toBeTruthy();
    },
  );
});
