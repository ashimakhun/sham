// QA ARU-185: gaps in aru185-legal-footer-links.test.tsx. Accountant mentor and Russian placement (AC 2); the footer is
// the very last element of Profile's group (AC 2); body weight exactly Light 300 (AC 1); wrapping: each dot is grouped
// with the link before it, nothing truncated (AC 3–4); the tap area wraps the whole link and the dots sit outside it
// (AC 5); Contact us's "no mail app" / "can't open" messages and web address (AC 6); waiting / declined screens in
// Russian (AC 7); the dots aren't read (AC 8); other Profile buttons stay upper case, the sign-up checkbox and the
// Terms update screen keep their underlined primary-colour links (AC 9, out of scope).
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, Linking, Platform, StyleSheet, Text } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import { AccessGate } from '@/components/AccessGate';
import { AgreeCheckbox } from '@/components/LegalLinks';
import { LegalUpdateScreen } from '@/components/LegalUpdateScreen';
import { I18nContext, make } from '@/i18n/context';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import { font } from '@/lib/fonts';
import { CONTACT_EMAIL, LEGAL_URLS } from '@/lib/legal';
import { colors } from '@/lib/theme';
import type { User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/components/Accountant', () => ({ AccountantSection: () => null }));

const flat = (node: { props: { style?: any } }) => StyleSheet.flatten(node.props.style) as Record<string, unknown>;
const inRu = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const LINK_IDS = ['legal-privacy-link', 'legal-terms-link', 'legal-contact-link'] as const;
const accountant: User = { ...users.M2, isAccountant: true };

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

type Node = { type: string; props: Record<string, any>; children: (Node | string)[] | null };
const serialise = () => JSON.stringify(screen.toJSON(), (k, v) => (k === 'refreshControl' ? undefined : v));

describe('AC 2: the footer is the last thing on Profile', () => {
  it.each([
    ['student', users.S1, 'en'],
    ['mentor', users.M, 'en'],
    ['accountant mentor', accountant, 'en'],
    ['teacher', users.T, 'en'],
    ['student (Russian)', users.S1, 'ru'],
    ['teacher (Russian)', users.T, 'ru'],
  ] as const)('%s: legal-links is the last child of the button group, after Sign out / Delete account', async (_r, user, lang) => {
    setStore(fakeStore(null, { currentUser: user }));
    await render(lang === 'ru' ? inRu(<ProfileScreen />) : <ProfileScreen />);
    const cat = lang === 'ru' ? ru : en;
    const footer = screen.getByTestId('legal-links');
    // Its parent is the Profile button group; nothing comes after it there.
    const group = footer.parent!;
    const siblings = group.children.filter((c) => typeof c !== 'string');
    expect(siblings[siblings.length - 1]).toBe(footer);
    const json = serialise();
    const at = json.indexOf('"legal-links"');
    expect(at).toBeGreaterThan(json.lastIndexOf(cat['common.signOut']));
    // ARU-180 AC 1: every role, the teacher included, has Delete account, and the footer comes after it.
    expect(at).toBeGreaterThan(json.lastIndexOf(cat['common.deleteAccount']));
    // Negative: no longer between Reports / Manage roles and Change password.
    expect(at).toBeGreaterThan(json.indexOf(cat['profile.changePassword']));
    // Every button on Profile comes before the links (they're links, not buttons).
    const buttons = screen.getAllByRole('button');
    const last = buttons[buttons.length - 1];
    expect(json.indexOf(JSON.stringify(last.props.testID ?? '__none__'))).toBeLessThan(at);
    expect(within(footer).queryAllByRole('button')).toHaveLength(0);
  });

  it('the last Profile button is still Delete account (student and teacher, ARU-180 AC 1), right after Sign out', async () => {
    setStore(fakeStore('S1'));
    const { unmount } = await render(<ProfileScreen />);
    let buttons = screen.getAllByRole('button');
    expect(buttons[buttons.length - 1]).toBe(screen.getByRole('button', { name: en['common.deleteAccount'] }));
    await unmount();
    setStore(fakeStore('T'));
    await render(<ProfileScreen />);
    buttons = screen.getAllByRole('button');
    // ARU-180 AC 1: the teacher's last button is Delete account, below Sign out (was: Sign out last).
    expect(buttons[buttons.length - 1]).toBe(screen.getByRole('button', { name: en['common.deleteAccount'] }));
    expect(buttons[buttons.length - 2]).toBe(screen.getByRole('button', { name: en['common.signOut'] }));
  });
});

describe('AC 1 / AC 9: look', () => {
  it.each(['en', 'ru'] as const)('%s: Inter Light 300 (the body weight), muted, 12 pt, normal case, no underline', async (lang) => {
    setStore(fakeStore('M'));
    await render(lang === 'ru' ? inRu(<ProfileScreen />) : <ProfileScreen />);
    for (const id of LINK_IDS) {
      const s = flat(screen.getByTestId(id));
      expect(s.fontFamily).toBe(font(300).fontFamily);
      expect(s.color).toBe(colors.muted);
      expect(colors.muted.toUpperCase()).toBe('#6B7280');
      expect(s.fontSize).toBe(12);
      expect(s.textTransform ?? 'none').toBe('none');
      expect(s.letterSpacing ?? 0).toBe(0);
      expect(s.textDecorationLine ?? 'none').toBe('none');
      expect(s.color).not.toBe(colors.primary);
    }
  });

  it('AC 9 regression: the other Profile buttons are still upper case (ARU-122)', async () => {
    setStore(fakeStore('T'));
    await render(<ProfileScreen />);
    for (const key of ['profile.changePassword', 'common.signOut', 'profile.manageRoles'] as const) {
      expect(flat(screen.getByText(en[key]))).toMatchObject({ textTransform: 'uppercase', ...font(500) });
    }
  });
});

describe('AC 3 / AC 4: one centred row that wraps as whole links', () => {
  it('each dot is in one non-breaking group with the link before it; no truncation', async () => {
    setStore(fakeStore('S1'));
    await render(inRu(<ProfileScreen />));
    const row = screen.getByTestId('legal-links');
    expect(flat(row)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' });
    const groups = (row.children as unknown as Node[]).filter((c) => typeof c !== 'string');
    expect(groups).toHaveLength(3);
    const dots = screen.getAllByText('·', { includeHiddenElements: true });
    // groups 1 and 2 end with a dot; group 3 (Contact us) has none; no group starts with a dot.
    expect(within(groups[0] as never).getAllByText('·', { includeHiddenElements: true })).toHaveLength(1);
    expect(within(groups[1] as never).getAllByText('·', { includeHiddenElements: true })).toHaveLength(1);
    expect(within(groups[2] as never).queryAllByText('·', { includeHiddenElements: true })).toHaveLength(0);
    expect(dots).toHaveLength(2);
    for (const g of groups) expect(flat(g as never).flexWrap ?? 'nowrap').toBe('nowrap');
    for (const id of LINK_IDS) {
      const text = screen.getByTestId(id);
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.ellipsizeMode).toBeUndefined();
      expect(text.props.adjustsFontSizeToFit).toBeUndefined();
    }
    // Russian texts as in the catalog, in order.
    const json = JSON.stringify(row);
    const order = [ru['legal.privacyPolicy'], ru['legal.termsOfUse'], ru['legal.contactUs']].map((s) => json.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('AC 5: tap area', () => {
  it('the 44 × 44 pressable holds the link text and not the dot; pressing the area (not the text) opens the link', async () => {
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    const link = screen.getByRole('link', { name: en['legal.termsOfUse'] });
    expect(flat(link)).toMatchObject({ minHeight: 44, minWidth: 44 });
    expect(within(link).getByTestId('legal-terms-link')).toBeTruthy();
    expect(within(link).queryAllByText('·', { includeHiddenElements: true })).toHaveLength(0);
    await fireEvent.press(link);
    expect(openURL).toHaveBeenLastCalledWith(LEGAL_URLS.terms.en);
    for (const dot of screen.getAllByText('·', { includeHiddenElements: true })) {
      expect(dot.props.onPress).toBeUndefined();
    }
  });
});

describe('AC 6: Contact us messages unchanged', () => {
  it('no mail app / openURL rejects: the message with the address', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    setStore(fakeStore('S1'));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('link', { name: en['legal.contactUs'] }));
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.stringify((Alert.alert as jest.Mock).mock.calls)).toContain(CONTACT_EMAIL);
  });

  it('a document that can\'t open: the "can\'t open" message (Russian)', async () => {
    openURL.mockRejectedValueOnce(new Error('offline'));
    setStore(fakeStore('S1'));
    await render(inRu(<ProfileScreen />));
    await fireEvent.press(screen.getByRole('link', { name: ru['legal.privacyPolicy'] }));
    await new Promise((r) => setTimeout(r, 0));
    expect(openURL).toHaveBeenCalledWith(LEGAL_URLS.privacy.ru);
    expect(JSON.stringify((Alert.alert as jest.Mock).mock.calls)).toContain(ru['legal.linkFailed']);
  });

  it('web: Contact us also shows the address', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const alertSpy = jest.fn();
    const g = globalThis as unknown as { alert?: (m: string) => void };
    const prev = g.alert;
    g.alert = alertSpy;
    try {
      setStore(fakeStore('S1'));
      await render(<ProfileScreen />);
      await fireEvent.press(screen.getByRole('link', { name: en['legal.contactUs'] }));
      await new Promise((r) => setTimeout(r, 0));
      expect(openURL).toHaveBeenLastCalledWith(`mailto:${CONTACT_EMAIL}?subject=Sham`);
      const shown = JSON.stringify([alertSpy.mock.calls, (Alert.alert as jest.Mock).mock.calls]);
      expect(shown).toContain(CONTACT_EMAIL);
    } finally {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
      g.alert = prev;
    }
  });
});

describe('AC 7 / AC 8: waiting / declined screen, screen readers', () => {
  it.each(['pending', 'rejected'] as const)('%s (Russian): footer look, centred, last, links read as links, dots hidden', async (status) => {
    setStore(fakeStore(null, { currentUser: { ...users.M, accessStatus: status } }));
    await render(
      inRu(
        <AccessGate>
          <Text>The app</Text>
        </AccessGate>,
      ),
    );
    const footer = screen.getByTestId('legal-links');
    const siblings = footer.parent!.children.filter((c) => typeof c !== 'string');
    expect(siblings[siblings.length - 1]).toBe(footer);
    const json = serialise();
    expect(json.indexOf('"legal-links"')).toBeGreaterThan(json.lastIndexOf(ru['common.deleteAccount']));
    expect(flat(footer).justifyContent).toBe('center');
    for (const [id, key] of [
      ['legal-privacy-link', 'legal.privacyPolicy'],
      ['legal-terms-link', 'legal.termsOfUse'],
      ['legal-contact-link', 'legal.contactUs'],
    ] as const) {
      expect(flat(screen.getByTestId(id))).toMatchObject({ fontSize: 12, color: colors.muted, ...font(300) });
      expect(screen.getByRole('link', { name: ru[key] })).toBeTruthy();
    }
    expect(screen.queryByText('·')).toBeNull();
    for (const dot of screen.getAllByText('·', { includeHiddenElements: true })) {
      expect(dot.props.accessible).toBe(false);
      expect(dot.props['aria-hidden']).toBe(true);
    }
  });
});

describe('Out of scope: other legal links keep their look', () => {
  it('sign-up checkbox links stay underlined in the primary colour', async () => {
    await render(<AgreeCheckbox checked={false} onChange={() => {}} />);
    const terms = screen.getByText(en['legal.agreeTermsLink']);
    expect(flat(terms)).toMatchObject({ color: colors.primary, textDecorationLine: 'underline' });
  });

  it('the Terms / Privacy update screen links stay underlined in the primary colour', async () => {
    setStore(fakeStore('S1'));
    await render(<LegalUpdateScreen />);
    for (const id of ['legal-update-terms-link', 'legal-update-privacy-link']) {
      expect(flat(screen.getByTestId(id))).toMatchObject({ color: colors.primary, textDecorationLine: 'underline' });
    }
  });
});
