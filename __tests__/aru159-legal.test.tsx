// ARU-159: Privacy Policy and Terms of Use. The sign-up checkbox (AC 3, AC 4), the links on Profile and the waiting /
// declined screen (AC 6, AC 7), the "We've updated our Terms" screen (AC 8–10), the catalog (AC 11) and the four
// public pages (AC 1, AC 2).
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking, Platform, Text } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import SignInScreen from '@/app/index';
import { AccessGate } from '@/components/AccessGate';
import { I18nContext, make } from '@/i18n/context';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import { CONTACT_EMAIL, LEGAL_URLS, LEGAL_VERSION, legalUrl, needsLegalAgreement } from '@/lib/legal';
import type { User } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/components/Accountant', () => ({ AccountantSection: () => null }));

const fs = jest.requireActual<{ readFileSync: (file: string, encoding: 'utf8') => string }>('fs');

const button = (name: string) => screen.getByRole('button', { name });
const inRu = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const box = () => screen.getByTestId('legal-agree-checkbox');
const App = () => (
  <AccessGate>
    <Text>The app</Text>
  </AccessGate>
);

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function fillSignUp() {
  await fireEvent.press(screen.getByRole('tab', { name: 'Create account' }));
  await fireEvent.changeText(screen.getByPlaceholderText('Dana S.'), 'Dana');
  await fireEvent.changeText(screen.getByTestId('username-field'), 'dana_s');
  await fireEvent.changeText(screen.getByPlaceholderText('At least 6 characters'), 'secret1');
  await fireEvent.press(screen.getByRole('tab', { name: 'Join a workspace' }));
  await fireEvent.changeText(screen.getByPlaceholderText('8 letters and digits'), 'ABCD2345');
}

describe('AC 3 / AC 4: the sign-up checkbox', () => {
  it('shows an unticked checkbox below the workspace choice, with both names as links', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    expect(screen.queryByTestId('legal-agree-checkbox')).toBeNull(); // AC 4: not in Sign in mode
    await fillSignUp();
    expect(box().props.accessibilityRole).toBe('checkbox');
    expect(box().props.accessibilityState).toEqual({ checked: false });
    expect(box().props.accessibilityLabel).toBe(
      "I'm 13 or older, and if I'm under 18 my parent or guardian agrees. I agree to the Terms of Use and Privacy Policy.",
    );
    expect(screen.getByTestId('legal-agree-terms-link').props.accessibilityRole).toBe('link');
    expect(screen.getByTestId('legal-agree-privacy-link').props.accessibilityRole).toBe('link');
    // Edge case: at least 44 pt tall.
    const style = [box().props.style].flat();
    expect(style.some((s: { minHeight?: number }) => (s?.minHeight ?? 0) >= 44)).toBe(true);
    // Below the workspace choice.
    const json = JSON.stringify(screen.toJSON());
    expect(json.indexOf('workspace-choice')).toBeLessThan(json.indexOf('legal-agree-checkbox'));
  });

  it('Create account stays disabled until the box is ticked; then it signs up as today', async () => {
    const signUp = jest.fn(async () => {});
    setStore(fakeStore(null, { signUp }));
    await render(<SignInScreen />);
    await fillSignUp();
    expect(button('Create account')).toBeDisabled();
    await fireEvent.press(box());
    expect(box().props.accessibilityState).toEqual({ checked: true });
    expect(button('Create account')).toBeEnabled();
    await fireEvent.press(button('Create account'));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith('Dana', 'dana_s', 'secret1', { kind: 'join', code: 'ABCD2345' }));
    // Unticking disables it again.
    await fireEvent.press(box());
    expect(button('Create account')).toBeDisabled();
  });

  it('switching to Sign in hides the box and keeps its state; Sign in needs no box', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    await fillSignUp();
    await fireEvent.press(box());
    await fireEvent.press(screen.getByRole('tab', { name: 'Sign in' }));
    expect(screen.queryByTestId('legal-agree-checkbox')).toBeNull();
    expect(button('Sign in')).toBeEnabled();
    await fireEvent.press(screen.getByRole('tab', { name: 'Create account' }));
    expect(box().props.accessibilityState).toEqual({ checked: true });
  });

  it('a link opens the document in the app language and does not tick the box', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    await fillSignUp();
    await fireEvent.press(screen.getByTestId('legal-agree-terms-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.en);
    await fireEvent.press(screen.getByTestId('legal-agree-privacy-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.en);
    expect(box().props.accessibilityState).toEqual({ checked: false });
  });

  it('Russian: the label is translated and the links open the Russian pages', async () => {
    setStore(fakeStore(null));
    await render(inRu(<SignInScreen />));
    await fireEvent.press(screen.getByRole('tab', { name: 'Регистрация' }));
    expect(box().props.accessibilityLabel).toBe(ru['legal.agreeA11y']);
    expect(screen.getByText('Условия использования')).toBeTruthy();
    expect(screen.getByText('Политику конфиденциальности')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('legal-agree-terms-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.ru);
  });

  it('a link that cannot open shows a message and changes nothing', async () => {
    openURL.mockRejectedValueOnce(new Error('no browser'));
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    await fillSignUp();
    await fireEvent.press(screen.getByTestId('legal-agree-privacy-link'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(en['legal.linkFailed'], undefined));
    expect(box().props.accessibilityState).toEqual({ checked: false });
  });

  it('screen readers can tick the box and open both documents through its actions', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    await fillSignUp();
    await fireEvent(box(), 'accessibilityAction', { nativeEvent: { actionName: 'openTerms' } });
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.en);
    await fireEvent(box(), 'accessibilityAction', { nativeEvent: { actionName: 'openPrivacy' } });
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.en);
    await fireEvent(box(), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(box().props.accessibilityState).toEqual({ checked: true });
  });
});

describe('AC 6: Profile', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees Privacy Policy, Terms of Use and Contact us above Change password', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    const json = JSON.stringify(screen.toJSON());
    expect(json.indexOf('legal-links')).toBeGreaterThan(-1);
    expect(json.indexOf('legal-links')).toBeLessThan(json.indexOf('Change password'));
    await fireEvent.press(screen.getByText('Privacy Policy'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.en);
    await fireEvent.press(screen.getByText('Terms of Use'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.en);
    await fireEvent.press(screen.getByText('Contact us'));
    expect(openURL).toHaveBeenLastCalledWith(`mailto:${CONTACT_EMAIL}?subject=Sham`);
  });

  it('Russian app: the documents open in Russian', async () => {
    setStore(fakeStore('S1'));
    await render(inRu(<ProfileScreen />));
    await fireEvent.press(screen.getByText(ru['legal.privacyPolicy']));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.ru);
    expect(screen.getByText(ru['legal.contactUs'])).toBeTruthy();
  });

  it('no mail app: Contact us shows the address', async () => {
    openURL.mockRejectedValueOnce(new Error('no mail app'));
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByText('Contact us'));
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(`No mail app found. Write to us at ${CONTACT_EMAIL}.`, undefined),
    );
  });

  it('web: Contact us also shows the address (a browser cannot tell whether mail opened)', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const alert = jest.fn();
    (globalThis as { alert?: unknown }).alert = alert;
    try {
      setStore(fakeStore('S1'));
      await render(<ProfileScreen />);
      await fireEvent.press(screen.getByText('Contact us'));
      await waitFor(() => expect(alert).toHaveBeenCalledWith(`No mail app found. Write to us at ${CONTACT_EMAIL}.`));
    } finally {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
      delete (globalThis as { alert?: unknown }).alert;
    }
  });
});

describe('AC 7: the waiting / declined screen', () => {
  const pat: User = { id: 'P', name: 'Pending Pat', role: 'student', accessStatus: 'pending' };
  const rae: User = { id: 'R', name: 'Rejected Rae', role: 'student', accessStatus: 'rejected' };
  it.each([pat, rae])('$accessStatus shows the three links, and its buttons stay', async (user) => {
    setStore(fakeStore(null, { currentUser: user }));
    await render(<App />);
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
    expect(screen.getByText('Terms of Use')).toBeTruthy();
    expect(screen.getByText('Contact us')).toBeTruthy();
    expect(button('Sign out')).toBeTruthy();
    expect(button('Delete account')).toBeTruthy();
    await fireEvent.press(screen.getByText('Terms of Use'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.en);
  });
});

describe('AC 8–10: "We\'ve updated our Terms"', () => {
  it('comes before everything else, with both links, I agree and Sign out', async () => {
    const store = fakeStore('S1', { needsLegalAgreement: true, needsUsername: true });
    setStore(store);
    await render(<App />);
    expect(screen.queryByText('The app')).toBeNull();
    expect(screen.getByText("We've updated our Terms")).toBeTruthy();
    await fireEvent.press(screen.getByTestId('legal-update-terms-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.en);
    await fireEvent.press(screen.getByTestId('legal-update-privacy-link'));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.en);
    await fireEvent.press(button('I agree'));
    expect(store.agreeToTerms).toHaveBeenCalled();
    await fireEvent.press(button('Sign out'));
    expect(store.signOut).toHaveBeenCalled();
  });

  it('also before the waiting screen', async () => {
    setStore(fakeStore(null, { currentUser: { id: 'P', name: 'Pat', role: 'student', accessStatus: 'pending' }, needsLegalAgreement: true }));
    await render(<App />);
    expect(screen.getByText("We've updated our Terms")).toBeTruthy();
    expect(screen.queryByText('Waiting for approval')).toBeNull();
  });

  it('offline: the error shows and the screen stays, so I agree can be tapped again', async () => {
    const agreeToTerms = jest.fn().mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValue(undefined);
    setStore(fakeStore('S1', { needsLegalAgreement: true, agreeToTerms }));
    await render(<App />);
    await fireEvent.press(button('I agree'));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByText("We've updated our Terms")).toBeTruthy();
    await fireEvent.press(button('I agree'));
    expect(agreeToTerms).toHaveBeenCalledTimes(2);
  });

  it('is not shown when the latest agreement is the current version', async () => {
    setStore(fakeStore('S1', { needsLegalAgreement: false }));
    await render(<App />);
    expect(screen.getByText('The app')).toBeTruthy();
  });

  it('Russian texts', async () => {
    setStore(fakeStore('S1', { needsLegalAgreement: true }));
    await render(inRu(<App />));
    expect(screen.getByText(ru['legal.updateTitle'])).toBeTruthy();
    expect(button(ru['legal.agree'])).toBeTruthy();
  });

  it('needsLegalAgreement: none or older asks, current or unknown (offline) does not', () => {
    expect(needsLegalAgreement(null)).toBe(true);
    expect(needsLegalAgreement(LEGAL_VERSION - 1)).toBe(true);
    expect(needsLegalAgreement(LEGAL_VERSION)).toBe(false);
    expect(needsLegalAgreement(LEGAL_VERSION + 1)).toBe(false);
    expect(needsLegalAgreement(undefined)).toBe(false);
  });
});

describe('AC 11: catalog', () => {
  it('every new text is in English and Russian', () => {
    const ids = Object.keys(en).filter((k) => k.startsWith('legal.'));
    expect(ids.length).toBeGreaterThanOrEqual(13);
    for (const id of ids) expect((ru as Record<string, string>)[id]?.trim()).toBeTruthy();
    expect(en['legal.agreeCheckbox']).toBe(
      "I'm 13 or older, and if I'm under 18 my parent or guardian agrees. I agree to the {terms} and {privacy}.",
    );
    expect(ru['legal.agreeCheckbox']).toBe(
      'Мне 13 лет или больше, и если мне меньше 18, мой родитель или законный представитель согласен. Я принимаю {terms} и {privacy}.',
    );
  });
});

describe('AC 1 / AC 2: the public pages', () => {
  const pages = [
    ['privacy.html', 'en', 'Privacy Policy', 'privacy-ru.html'],
    ['privacy-ru.html', 'ru', 'Политика конфиденциальности', 'privacy.html'],
    ['terms.html', 'en', 'Terms of Use', 'terms-ru.html'],
    ['terms-ru.html', 'ru', 'Условия использования', 'terms.html'],
  ] as const;
  it.each(pages)('legal/%s: language, title, version and date at the top, phone viewport, other language', (file, lang, title, other) => {
    const html = fs.readFileSync(`legal/${file}`, 'utf8');
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain(`<h1>${title}</h1>`);
    expect(html).toContain(lang === 'en' ? `Version ${LEGAL_VERSION}` : `Версия ${LEGAL_VERSION}`);
    expect(html).toContain(lang === 'en' ? 'Effective date: 20 November 2026' : 'Дата вступления в силу: 20 ноября 2026');
    expect(html).toContain(`href="${other}"`);
    expect(html).not.toMatch(/\[to fill\]|\[заполнить\]|уточнить у юриста|Before you publish/);
    // The version and date come before the text.
    const date = html.indexOf(lang === 'en' ? 'Effective date' : 'Дата вступления');
    expect(date).toBeGreaterThan(html.indexOf(lang === 'en' ? 'Version' : 'Версия'));
    expect(date).toBeLessThan(html.indexOf('<h2>'));
  });

  it('the app links to these four pages', () => {
    expect(legalUrl('privacy', 'en')).toMatch(/\/legal\/privacy\.html$/);
    expect(legalUrl('privacy', 'ru')).toMatch(/\/legal\/privacy-ru\.html$/);
    expect(legalUrl('terms', 'en')).toMatch(/\/legal\/terms\.html$/);
    expect(legalUrl('terms', 'ru')).toMatch(/\/legal\/terms-ru\.html$/);
  });
});
