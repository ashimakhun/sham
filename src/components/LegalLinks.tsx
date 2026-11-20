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

const linkStyle = [styles.caps, { color: colors.primary, fontSize: 14, paddingVertical: 12 }];

/** AC 6 / AC 7: Privacy Policy, Terms of Use and Contact us, as secondary links (Profile, waiting / declined screen). */
export function LegalLinks({ center }: { center?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <View
      testID="legal-links"
      style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, justifyContent: center ? 'center' : 'flex-start' }}>
      <Text accessibilityRole="link" testID="legal-privacy-link" style={linkStyle} onPress={() => openLegalDocument('privacy', lang)}>
        {t('legal.privacyPolicy')}
      </Text>
      <Text accessibilityRole="link" testID="legal-terms-link" style={linkStyle} onPress={() => openLegalDocument('terms', lang)}>
        {t('legal.termsOfUse')}
      </Text>
      <Text accessibilityRole="link" testID="legal-contact-link" style={linkStyle} onPress={() => contactUs(lang)}>
        {t('legal.contactUs')}
      </Text>
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
