import { Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { ErrorText, styles } from '@/components/ui';
import type { Language } from '@/i18n';
import { useFormLanguage } from '@/i18n/context';
import { useI18n, useLanguageSwitch } from '@/i18n/LanguageProvider';
import { colors } from '@/lib/theme';

/**
 * ARU-108 AC 3 / AC 10: the Profile tab's Language switch. Each option is written in its own language. Picking the
 * other one saves it on the account and every screen changes at once; while saving the switch is disabled, and if the
 * save fails the language stays and a red message shows (in that language).
 */
export function LanguageSwitch() {
  const { t } = useI18n();
  const { lang, saving, failed, choose } = useLanguageSwitch();
  return (
    <View style={[styles.card, { gap: 10 }]} testID="language-switch">
      <Text style={styles.label} accessibilityRole="header">
        {t('profile.language')}
      </Text>
      <LanguageOptions lang={lang} saving={saving} onChoose={(next) => void choose(next)} />
      {failed ? <ErrorText error={t('profile.languageSaveFailed')} /> : null}
    </View>
  );
}

/**
 * ARU-189: the Create account form's Language switch (AC 1, AC 2), with the Profile switch's markup (analysis note 4)
 * but no saving state or save error: picking changes this device's language at once and nothing is saved before
 * Create account (AC 3, AC 4).
 */
export function SignUpLanguageSwitch() {
  const { t, lang } = useI18n();
  const { choose } = useFormLanguage();
  return (
    <View style={{ gap: 6 }} testID="signup-language-switch">
      <Text style={styles.label} accessibilityRole="header">
        {t('signIn.language')}
      </Text>
      <LanguageOptions lang={lang} saving={false} onChoose={choose} />
    </View>
  );
}

function LanguageOptions({ lang, saving, onChoose }: { lang: Language; saving: boolean; onChoose: (next: Language) => void }) {
  const { t } = useI18n();
  // Each option is written in its own language, whatever the screen's language (ARU-108 AC 3).
  const options: { value: Language; label: string }[] = [
    { value: 'en', label: t('profile.languageEnglish') },
    { value: 'ru', label: t('profile.languageRussian') },
  ];
  return (
      <View style={styles.segmented} accessibilityRole="radiogroup">
        {options.map((o) => {
          const selected = o.value === lang;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: selected, disabled: saving }}
              disabled={saving}
              onPress={() => onChoose(o.value)}
              style={[styles.segment, selected && styles.segmentActive, saving && { opacity: 0.6 }]}>
              {/* ARU-144: wraps on a narrow screen rather than being cut with "…". */}
              <Text style={[styles.segmentText, selected && { color: colors.text }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
  );
}
