// ARU-159: links to the Privacy Policy and Terms of Use (public web pages, in the app's language) and Contact us.
import { Ionicons } from '@expo/vector-icons';
import { Linking, Platform, Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';
import { styles } from '@/components/ui';
import type { Language } from '@/i18n';
import { translate } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { notify } from '@/lib/confirm';
import { CONTACT_EMAIL, contactMailto, legalUrl, type LegalDocument } from '@/lib/legal';
import { colors } from '@/lib/theme';

/** Opens a document's page in the browser (a new tab on web). Edge case: it can't open → a message, nothing else. */
export async function openLegalDocument(doc: LegalDocument, lang: Language): Promise<void> {
  try {
    await Linking.openURL(legalUrl(doc, lang));
  } catch {
    notify(translate(lang, 'legal.linkFailed'));
  }
}

/** AC 6: a new email to the operator with the subject "Sham". Edge case: no mail app → a message with the address. */
export async function contactUs(lang: Language): Promise<void> {
  const noMail = () => notify(translate(lang, 'legal.noMailApp', { email: CONTACT_EMAIL }));
  try {
    await Linking.openURL(contactMailto());
    // A browser can't tell whether a mail app handled mailto:, so web always shows the address too.
    if (Platform.OS === 'web') noMail();
  } catch {
    noMail();
  }
}

// ARU-185 AC 1: small quiet footer links: 12 pt, normal case as in the catalog (an exception to ARU-122's upper case),
// muted grey, the app's body weight (AppText's default), not underlined.
const linkTextStyle = { color: colors.muted, fontSize: 12, textAlign: 'center' } as const;
// AC 5: a tap area of at least 44 × 44 pt around the 12 pt text.
const tapArea = { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' } as const;

function FooterLink({ label, testID, onPress }: { label: string; testID: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress} style={tapArea}>
      <Text testID={testID} style={linkTextStyle}>
        {label}
      </Text>
    </Pressable>
  );
}

/** AC 8: the middle dot between links: not tappable, not read or focused by screen readers. */
function Separator() {
  return (
    <Text
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      aria-hidden
      style={[linkTextStyle, { paddingHorizontal: 6 }]}>
      ·
    </Text>
  );
}

/**
 * ARU-159 AC 6 / AC 7, restyled by ARU-185: Privacy Policy · Terms of Use · Contact us as one centred footer row
 * (Profile, waiting / declined screen). Each dot stays in one group with the link before it, so when the row wraps
 * (Russian, large text) whole links move to the next centred line and no line starts with a dot.
 */
export function LegalLinks() {
  const { t, lang } = useI18n();
  const links = [
    { label: t('legal.privacyPolicy'), testID: 'legal-privacy-link', onPress: () => openLegalDocument('privacy', lang) },
    { label: t('legal.termsOfUse'), testID: 'legal-terms-link', onPress: () => openLegalDocument('terms', lang) },
    { label: t('legal.contactUs'), testID: 'legal-contact-link', onPress: () => contactUs(lang) },
  ];
  return (
    <View
      testID="legal-links"
      style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
      {links.map((link, i) => (
        <View key={link.testID} style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '100%' }}>
          <FooterLink {...link} />
          {i < links.length - 1 && <Separator />}
        </View>
      ))}
    </View>
  );
}

/** Splits a catalog text on its {placeholders}, so parts of it can be links. */
function splitPlaceholders(text: string): (string | { name: string })[] {
  return text.split(/(\{\w+\})/).filter(Boolean).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m ? { name: m[1] } : part;
  });
}

/**
 * ARU-159 AC 3: the sign-up checkbox (age and agreement in one), unticked until tapped. The two document names are
 * links: tapping one opens the page and doesn't tick the box. Read by screen readers as a checkbox with its state;
 * the links are also its accessibility actions.
 */
export function AgreeCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const { t, lang } = useI18n();
  const links: Record<string, { doc: LegalDocument; label: string }> = {
    terms: { doc: 'terms', label: t('legal.agreeTermsLink') },
    privacy: { doc: 'privacy', label: t('legal.agreePrivacyLink') },
  };
  return (
    <Pressable
      testID="legal-agree-checkbox"
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={t('legal.agreeA11y')}
      accessibilityActions={[
        { name: 'activate' },
        { name: 'openTerms', label: t('legal.termsOfUse') },
        { name: 'openPrivacy', label: t('legal.privacyPolicy') },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'openTerms') openLegalDocument('terms', lang);
        else if (e.nativeEvent.actionName === 'openPrivacy') openLegalDocument('privacy', lang);
        else onChange(!checked);
      }}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 44, paddingVertical: 6 }}>
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={24}
        color={colors.primary}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text style={[styles.body, { flex: 1 }]}>
        {splitPlaceholders(t('legal.agreeCheckbox')).map((part, i) => {
          if (typeof part === 'string') return part;
          const link = links[part.name];
          if (!link) return null;
          return (
            <Text
              key={i}
              accessibilityRole="link"
              testID={`legal-agree-${link.doc}-link`}
              style={{ color: colors.primary, textDecorationLine: 'underline' }}
              onPress={() => openLegalDocument(link.doc, lang)}>
              {link.label}
            </Text>
          );
        })}
      </Text>
    </Pressable>
  );
}
