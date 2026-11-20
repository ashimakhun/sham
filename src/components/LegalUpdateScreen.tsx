import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/AppText';
import { openLegalDocument } from '@/components/LegalLinks';
import { Button, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

/**
 * ARU-159 AC 8–10: "We've updated our Terms", for a signed-in account whose latest agreement is older than the current
 * version (or missing). AccessGate shows it before anything else (Choose a username, the waiting / declined screen and
 * the tabs), whatever route is open. After I agree (saved), the app continues as usual.
 */
export function LegalUpdateScreen() {
  const { agreeToTerms, signOut } = useStore();
  const { t, tm, lang } = useI18n();
  const { busy, error, run } = useAction();
  const linkStyle = [styles.body, { color: colors.primary, textDecorationLine: 'underline' as const, paddingVertical: 10 }];
  return (
    <SafeAreaView style={styles.screen} testID="legal-update-screen">
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <View style={{ gap: 8 }}>
          <Text style={[styles.h1, { textAlign: 'center' }]} accessibilityRole="header">
            {t('legal.updateTitle')}
          </Text>
          <Text style={[styles.body, { textAlign: 'center' }]}>{t('legal.updateText')}</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text accessibilityRole="link" testID="legal-update-terms-link" style={linkStyle} onPress={() => openLegalDocument('terms', lang)}>
            {t('legal.termsOfUse')}
          </Text>
          <Text
            accessibilityRole="link"
            testID="legal-update-privacy-link"
            style={linkStyle}
            onPress={() => openLegalDocument('privacy', lang)}>
            {t('legal.privacyPolicy')}
          </Text>
        </View>
        {/* AC 9: offline → the error, the screen stays, and I agree can be tapped again. */}
        <ErrorText error={tm(error)} />
        <Button title={busy ? t('legal.agreeing') : t('legal.agree')} onPress={() => run(agreeToTerms)} disabled={busy} />
        <Button title={t('common.signOut')} variant="secondary" onPress={() => run(signOut)} disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}
