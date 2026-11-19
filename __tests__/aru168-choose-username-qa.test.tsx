// ARU-168 QA: the Choose a username gate beyond the dev tests: before the declined screen and on any route (AC 1),
// errors shown on the screen and Save usable again (AC 4), the screen and database errors in Russian (AC 10; the
// "on the screen" cases fail on 2b28a7f), and the gate leaving once the username is set (AC 3).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AccessGate, DECLINED_TITLE } from '@/components/AccessGate';
import { CHOOSE_USERNAME_TITLE } from '@/components/ChooseUsernameScreen';
import { dbErrorMessage, translate } from '@/i18n';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { NETWORK_ERROR } from '@/lib/password';
import type { User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en' }]) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const flush = () => act(async () => {});
const app = (route = 'Tabs') =>
  render(
    <LanguageProvider>
      <AccessGate>
        <Text>{route}</Text>
      </AccessGate>
    </LanguageProvider>,
  );
const fill = async (u: string, n: string) => {
  await fireEvent.changeText(screen.getByTestId('choose-username-field'), u);
  await fireEvent.changeText(screen.getByTestId('choose-display-name-field'), n);
};

describe('AC 1: before everything', () => {
  it('comes before the declined screen', async () => {
    setStore(fakeStore(null, { currentUser: { ...users.S1, accessStatus: 'rejected' }, needsUsername: true, myUsername: null }));
    await app();
    await flush();
    expect(screen.getByText(CHOOSE_USERNAME_TITLE)).toBeTruthy();
    expect(screen.queryByText(DECLINED_TITLE)).toBeNull();
  });

  it('a deep link (any route inside the gate) shows only the screen', async () => {
    setStore(fakeStore('T', { needsUsername: true, myUsername: null }));
    await app('Manage roles route');
    await flush();
    expect(screen.getByText(CHOOSE_USERNAME_TITLE)).toBeTruthy();
    expect(screen.queryByText('Manage roles route')).toBeNull();
  });

  it('while the username is unknown (not loaded) the gate does not show', async () => {
    setStore(fakeStore('S1', { needsUsername: false, myUsername: undefined }));
    await app();
    await flush();
    expect(screen.queryByText(CHOOSE_USERNAME_TITLE)).toBeNull();
    expect(screen.getByText('Tabs')).toBeTruthy();
  });
});

describe('AC 4: errors', () => {
  it('a server or network error shows, and Save can be pressed again', async () => {
    const choose = jest
      .fn()
      .mockRejectedValueOnce(new Error(NETWORK_ERROR))
      .mockResolvedValueOnce(undefined);
    setStore(fakeStore('S1', { needsUsername: true, myUsername: null, chooseUsername: choose }));
    await app();
    await flush();
    await fill('dana', 'Dana');
    await fireEvent.press(screen.getByText('Save'));
    await flush();
    expect(screen.getByText(NETWORK_ERROR)).toBeTruthy();
    expect(screen.getByText(CHOOSE_USERNAME_TITLE)).toBeTruthy();
    await fireEvent.press(screen.getByText('Save'));
    await flush();
    expect(choose).toHaveBeenCalledTimes(2);
  });
});

describe('AC 10: Russian', () => {
  const ruUser = (): User => ({ ...users.S1, language: 'ru' });

  it('the screen is in Russian', async () => {
    setStore(fakeStore(null, { currentUser: ruUser(), needsUsername: true, myUsername: null }));
    await app();
    await flush();
    expect(screen.getByText(translate('ru', 'chooseUsername.title'))).toBeTruthy();
    expect(screen.getByText(translate('ru', 'chooseUsername.text'))).toBeTruthy();
    expect(screen.getByLabelText(translate('ru', 'chooseUsername.usernameA11y'))).toBeTruthy();
    expect(screen.getByLabelText(translate('ru', 'chooseUsername.displayNameA11y'))).toBeTruthy();
    expect(screen.queryByText(CHOOSE_USERNAME_TITLE)).toBeNull();
  });

  it.each([
    ['sham:username_already_set', 'db.username_already_set'],
    ['sham:username_invalid', 'db.username_invalid'],
    ['sham:display_name_invalid', 'db.display_name_invalid'],
    ['sham:username_taken', 'db.username_taken'],
  ])('a database error %s becomes the Russian text', (hint, key) => {
    const error = { message: translate('en', key), code: '23505', hint } as never;
    expect(dbErrorMessage(error, 'ru')).toBe(translate('ru', key));
    expect(dbErrorMessage(error, 'en')).toBe(translate('en', key));
  });

  // The store throws dbErrorMessage(error) in the current language (Russian here), as for every other server refusal
  // (sign_in_again after an expired session, username_invalid / display_name_invalid from the server).
  it.each(['sign_in_again', 'username_invalid', 'display_name_invalid'])(
    'a database refusal %s shows in Russian on the screen (not the generic error)',
    async (code) => {
      const key = `db.${code}`;
      const thrown = dbErrorMessage({ message: translate('en', key as never), code: '42501', hint: `sham:${code}` } as never, 'ru');
      setStore(
        fakeStore(null, {
          currentUser: ruUser(),
          needsUsername: true,
          myUsername: null,
          chooseUsername: jest.fn(async () => {
            throw new Error(thrown);
          }),
        }),
      );
      await app();
      await flush();
      await fill('dana', 'Dana');
      await fireEvent.press(screen.getByText(translate('ru', 'common.save')));
      await flush();
      expect(screen.getByText(translate('ru', key as never))).toBeTruthy();
    },
  );
});

describe('AC 3: after Save', () => {
  it('once the username is known the app continues to the tabs', async () => {
    setStore(fakeStore('S1', { needsUsername: true, myUsername: null }));
    const view = await app();
    await flush();
    expect(screen.getByText(CHOOSE_USERNAME_TITLE)).toBeTruthy();
    setStore(fakeStore('S1', { needsUsername: false, myUsername: 'dana' }));
    view.rerender(
      <LanguageProvider>
        <AccessGate>
          <Text>Tabs</Text>
        </AccessGate>
      </LanguageProvider>,
    );
    await flush();
    expect(screen.queryByText(CHOOSE_USERNAME_TITLE)).toBeNull();
    expect(screen.getByText('Tabs')).toBeTruthy();
  });
});
