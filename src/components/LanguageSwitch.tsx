import { Pressable, Text, View } from 'react-native';

import { ErrorText, styles } from '@/components/ui';
import type { Language } from '@/i18n';
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
  const options: { value: Language; label: string }[] = [
    { value: 'en', label: t('profile.languageEnglish') },
    { value: 'ru', label: t('profile.languageRussian') },
  ];
  return (
    <View style={[styles.card, { gap: 10 }]} testID="language-switch">
      <Text style={styles.label} accessibilityRole="header">
        {t('profile.language')}
      </Text>
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
              onPress={() => void choose(o.value)}
              style={[styles.segment, selected && styles.segmentActive, saving && { opacity: 0.6 }]}>
              <Text style={[styles.segmentText, selected && { color: colors.text }]} numberOfLines={1}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {failed ? <ErrorText error={t('profile.languageSaveFailed')} /> : null}
    </View>
  );
}
