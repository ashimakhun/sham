// QA ARU-159: gaps in aru159-legal.test.tsx. Profile links for every role, in place above Change password, in
// English and Russian (AC 6); Contact us's mailto (AC 6); Create account still needs the workspace with the box ticked
// (AC 4); the update screen before Save your recovery code and the declined screen, over any route, then the route
// underneath after agreeing (AC 8–10); its links follow the app language; the public pages carry the effective date from
// src/lib/legal.ts and nothing else than their own document (AC 1 / AC 2).
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking, Text } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import SignInScreen from '@/app/index';
import { AccessGate } from '@/components/AccessGate';
import { I18nContext, make } from '@/i18n/context';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import { CONTACT_EMAIL, LEGAL_EFFECTIVE_DATE, LEGAL_URLS, LEGAL_VERSION, contactMailto } from '@/lib/legal';
import type { User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/components/Accountant', () => ({ AccountantSection: () => null }));

const fs = jest.requireActual<{ readFileSync: (file: string, encoding: 'utf8') => string }>('fs');
const inRu = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const button = (name: string) => screen.getByRole('button', { name });
const DeepRoute = () => (
  <AccessGate>
    <Text>Course details deep link</Text>
  </AccessGate>
);

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('AC 6: Profile links, every role', () => {
  const accountant: User = { ...users.M2, isAccountant: true };
  it.each([
    ['student', users.S1],
    ['mentor', users.M],
    ['accountant mentor', accountant],
    ['teacher', users.T],
  ])('%s: Privacy Policy, Terms of Use and Contact us, above Change password', async (_role, user) => {
    setStore(fakeStore(null, { currentUser: user }));
    await render(<ProfileScreen />);
    const json = JSON.stringify(screen.toJSON());
    const links = json.indexOf('legal-links');
    expect(links).toBeGreaterThan(-1);
    expect(links).toBeLessThan(json.indexOf('Change password'));
    expect(screen.getByTestId('legal-privacy-link')).toHaveTextContent('Privacy Policy');
    expect(screen.getByTestId('legal-terms-link')).toHaveTextContent('Terms of Use');
    expect(screen.getByTestId('legal-contact-link')).toHaveTextContent('Contact us');
    await fireEvent.press(screen.getByTestId('legal-privacy-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.en);
    await fireEvent.press(screen.getByTestId('legal-terms-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.en);
  });

  it('Contact us opens a new email to the operator with the subject "Sham"', async () => {
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByTestId('legal-contact-link'));
    expect(contactMailto()).toBe(`mailto:${CONTACT_EMAIL}?subject=Sham`);
    expect(CONTACT_EMAIL).toBe('ashimakhun.a@gmail.com');
    expect(openURL).toHaveBeenLastCalledWith('mailto:ashimakhun.a@gmail.com?subject=Sham');
    expect(Alert.alert).not.toHaveBeenCalled(); // a mail app opened: no message on a phone
  });

  it('Russian app: Russian link texts, and both documents open in Russian', async () => {
    setStore(fakeStore('T'));
    await render(inRu(<ProfileScreen />));
    expect(screen.getByTestId('legal-privacy-link')).toHaveTextContent(ru['legal.privacyPolicy']);
    expect(screen.getByTestId('legal-contact-link')).toHaveTextContent(ru['legal.contactUs']);
    await fireEvent.press(screen.getByTestId('legal-privacy-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.ru);
    await fireEvent.press(screen.getByTestId('legal-terms-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.ru);
  });
});

describe('AC 3 / AC 4: the sign-up box', () => {
  it('ticked box but no workspace choice: Create account stays disabled (as today)', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Create account' }));
    await fireEvent.changeText(screen.getByPlaceholderText('Dana S.'), 'Dana');
    await fireEvent.changeText(screen.getByTestId('username-field'), 'dana_s');
    await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
    await fireEvent.press(screen.getByTestId('legal-agree-checkbox'));
    expect(screen.getByTestId('legal-agree-checkbox').props.accessibilityState).toEqual({ checked: true });
    expect(button('Create account')).toBeDisabled();
  });

  it('Russian: the box shows the agreed Russian wording, links in Russian', async () => {
    setStore(fakeStore(null));
    await render(inRu(<SignInScreen />));
    await fireEvent.press(screen.getByRole('tab', { name: ru['signIn.modeSignUp'] }));
    expect(screen.getByTestId('legal-agree-checkbox').props.accessibilityLabel).toBe(
      'Мне 13 лет или больше, и если мне меньше 18, мой родитель или законный представитель согласен. Я принимаю Условия использования и Политику конфиденциальности.',
    );
    expect(screen.getByTestId('legal-agree-checkbox').props.accessibilityState).toEqual({ checked: false });
    await fireEvent.press(screen.getByTestId('legal-agree-privacy-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.ru);
    expect(screen.getByTestId('legal-agree-checkbox').props.accessibilityState).toEqual({ checked: false });
  });

  it('English label is the agreed AC 3 wording', () => {
    expect(en['legal.agreeA11y']).toBe(
      "I'm 13 or older, and if I'm under 18 my parent or guardian agrees. I agree to the Terms of Use and Privacy Policy.",
    );
  });
});

describe('AC 8–10: the update screen', () => {
  it('comes before Save your recovery code', async () => {
    setStore(fakeStore('S1', { needsLegalAgreement: true, needsRecoveryCode: true }));
    await render(<DeepRoute />);
    expect(screen.getByTestId('legal-update-screen')).toBeTruthy();
  });

  it('comes before the declined screen', async () => {
    setStore(fakeStore(null, { currentUser: { ...users.S2, accessStatus: 'rejected' }, needsLegalAgreement: true }));
    await render(<DeepRoute />);
    expect(screen.getByTestId('legal-update-screen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull(); // AC 8: only I agree and Sign out
  });

  it('a deep link lands on it; after agreeing, the route underneath renders (no redirect)', async () => {
    setStore(fakeStore('M', { needsLegalAgreement: true }));
    const view = await render(<DeepRoute />);
    expect(screen.queryByText('Course details deep link')).toBeNull();
    setStore(fakeStore('M', { needsLegalAgreement: false }));
    await view.rerender(<DeepRoute />);
    expect(screen.getByText('Course details deep link')).toBeTruthy();
    expect(screen.queryByTestId('legal-update-screen')).toBeNull();
  });

  it('Russian app: its links open the Russian pages', async () => {
    setStore(fakeStore('S1', { needsLegalAgreement: true }));
    await render(inRu(<DeepRoute />));
    await fireEvent.press(screen.getByTestId('legal-update-terms-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.ru);
    await fireEvent.press(screen.getByTestId('legal-update-privacy-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.ru);
    expect(button(ru['common.signOut'])).toBeTruthy();
  });

  it('signed out: never shown (the sign-in screen is not gated)', async () => {
    setStore(fakeStore(null, { needsLegalAgreement: false }));
    await render(<DeepRoute />);
    expect(screen.queryByTestId('legal-update-screen')).toBeNull();
  });
});

describe('AC 1 / AC 2: the pages', () => {
  it('the version is 1 and the effective date is 20 November 2026 (decided 20 Nov)', () => {
    expect(LEGAL_VERSION).toBe(1);
    expect(LEGAL_EFFECTIVE_DATE).toBe('2026-11-20');
  });

  it.each([
    ['privacy.html', 'Terms of Use'],
    ['privacy-ru.html', 'Условия использования'],
    ['terms.html', 'Privacy Policy'],
    ['terms-ru.html', 'Политика конфиденциальности'],
  ])('legal/%s holds one document only, no draft notes, no byline', (file, otherTitle) => {
    const html = fs.readFileSync(`legal/${file}`, 'utf8');
    expect(html).not.toContain(`<h1>${otherTitle}</h1>`);
    expect(html).not.toContain(`<h2>${otherTitle}</h2>`);
    expect(html).not.toMatch(/first draft|lawyer|юрист|Data localization|Русская версия|При расхождении/);
    expect(html).not.toMatch(/<script/i); // static page
    expect((html.match(/<h1>/g) ?? []).length).toBe(1);
  });

  it('the README lists the four App Store Connect addresses, as in src/lib/legal.ts', () => {
    const readme = fs.readFileSync('README.md', 'utf8');
    for (const url of [LEGAL_URLS.privacy.en, LEGAL_URLS.privacy.ru, LEGAL_URLS.terms.en, LEGAL_URLS.terms.ru]) {
      expect(readme).toContain(url);
    }
    expect(readme).toMatch(/GitHub Pages/);
  });
});
