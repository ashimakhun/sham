// ARU-185: the Privacy Policy, Terms of Use and Contact us links become small, muted footer links in normal case, at
// the very bottom of Profile, in one centred row with middle dots, each with a 44 pt tap area; same look on the
// waiting / declined screen.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking, StyleSheet, Text } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import { AccessGate } from '@/components/AccessGate';
import { I18nContext, make } from '@/i18n/context';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import { CONTACT_EMAIL, LEGAL_URLS } from '@/lib/legal';
import { colors } from '@/lib/theme';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/components/Accountant', () => ({ AccountantSection: () => null }));

const inRu = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const LINK_IDS = ['legal-privacy-link', 'legal-terms-link', 'legal-contact-link'] as const;

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** Host-tree order of every testID / text, to check what comes after what. */
function order(): string {
  // refreshControl (the gate screen's pull to refresh) holds a React element, which can't be serialised.
  return JSON.stringify(screen.toJSON(), (key, value) => (key === 'refreshControl' ? undefined : value));
}

function expectFooterLook() {
  for (const id of LINK_IDS) {
    const style = StyleSheet.flatten(screen.getByTestId(id).props.style);
    expect(style.fontSize).toBe(12);
    expect(style.color).toBe(colors.muted);
    expect(style.textTransform).toBeUndefined();
    expect(style.letterSpacing).toBeUndefined();
    expect(style.textDecorationLine).toBeUndefined();
    // AppText's body weight, not styles.caps' 500.
    expect(style.fontFamily).not.toMatch(/Medium|500/);
  }
}

describe('ARU-185 footer links on Profile', () => {
  it.each([
    ['student', users.S1, true],
    ['mentor', users.M, true],
    ['teacher', users.T, false],
  ])('%s: last on the page, after Sign out%s', async (_role, user, hasDelete) => {
    setStore(fakeStore(null, { currentUser: user }));
    await render(<ProfileScreen />);
    const json = order();
    const links = json.indexOf('legal-links');
    expect(links).toBeGreaterThan(json.indexOf(en['common.signOut']));
    expect(links).toBeGreaterThan(json.indexOf('Change password'));
    if (hasDelete) expect(links).toBeGreaterThan(json.indexOf(en['common.deleteAccount']));
    // Nothing after the footer: no other button's label after it.
    const after = json.slice(links);
    expect(after).not.toContain(en['common.signOut']);
    expect(after).not.toContain(en['common.deleteAccount']);
  });

  it('normal case, 12 pt, muted, in order with two middle dots, centred', async () => {
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    expect(screen.getByTestId('legal-privacy-link')).toHaveTextContent(en['legal.privacyPolicy'], { exact: true });
    expect(screen.getByTestId('legal-terms-link')).toHaveTextContent(en['legal.termsOfUse'], { exact: true });
    expect(screen.getByTestId('legal-contact-link')).toHaveTextContent(en['legal.contactUs'], { exact: true });
    expectFooterLook();
    const row = screen.getByTestId('legal-links');
    const rowStyle = StyleSheet.flatten(row.props.style);
    expect(rowStyle.justifyContent).toBe('center');
    expect(rowStyle.flexWrap).toBe('wrap');
    expect(screen.getAllByText('·', { includeHiddenElements: true })).toHaveLength(2);
    const json = JSON.stringify(row);
    const at = (s: string) => json.indexOf(s);
    expect(at(en['legal.privacyPolicy'])).toBeLessThan(at(en['legal.termsOfUse']));
    expect(at(en['legal.termsOfUse'])).toBeLessThan(at(en['legal.contactUs']));
  });

  it('Russian: the catalog texts, not upper case', async () => {
    setStore(fakeStore('S1'));
    await render(inRu(<ProfileScreen />));
    expect(screen.getByTestId('legal-privacy-link')).toHaveTextContent(ru['legal.privacyPolicy'], { exact: true });
    expect(screen.getByTestId('legal-terms-link')).toHaveTextContent(ru['legal.termsOfUse'], { exact: true });
    expect(screen.getByTestId('legal-contact-link')).toHaveTextContent(ru['legal.contactUs'], { exact: true });
    expectFooterLook();
    await fireEvent.press(screen.getByRole('link', { name: ru['legal.privacyPolicy'] }));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.ru);
  });

  it('each link is a 44 × 44 pt link for screen readers; the dots are hidden and not tappable', async () => {
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    for (const name of [en['legal.privacyPolicy'], en['legal.termsOfUse'], en['legal.contactUs']]) {
      const link = screen.getByRole('link', { name });
      const style = StyleSheet.flatten(link.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
    }
    expect(screen.queryByText('·')).toBeNull(); // hidden from accessibility
    for (const dot of screen.getAllByText('·', { includeHiddenElements: true })) {
      expect(dot.props.accessibilityElementsHidden).toBe(true);
      expect(dot.props.importantForAccessibility).toBe('no');
      await fireEvent.press(dot);
    }
    expect(openURL).not.toHaveBeenCalled();
  });

  it('the links still work', async () => {
    setStore(fakeStore('M'));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('link', { name: en['legal.privacyPolicy'] }));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.privacy.en);
    await fireEvent.press(screen.getByRole('link', { name: en['legal.termsOfUse'] }));
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.en);
    await fireEvent.press(screen.getByRole('link', { name: en['legal.contactUs'] }));
    expect(openURL).toHaveBeenLastCalledWith(`mailto:${CONTACT_EMAIL}?subject=Sham`);
  });
});

describe('ARU-185 AC 7: waiting / declined screen', () => {
  it.each(['pending', 'rejected'] as const)('%s: same footer look, below Delete account', async (status) => {
    setStore(fakeStore(null, { currentUser: { ...users.S1, accessStatus: status } }));
    await render(
      <AccessGate>
        <Text>The app</Text>
      </AccessGate>,
    );
    const json = order();
    expect(json.indexOf('legal-links')).toBeGreaterThan(json.indexOf(en['common.deleteAccount']));
    expectFooterLook();
    expect(StyleSheet.flatten(screen.getByTestId('legal-links').props.style).justifyContent).toBe('center');
  });
});
