import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeleteAccountForm } from '@/components/DeleteAccountForm';
import { Button, ErrorText, styles } from '@/components/ui';
import { translate } from '@/i18n';
import { useI18n } from '@/i18n/LanguageProvider';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

// ARU-108: the English texts (tests and other screens use them); the screen shows them in the chosen language.
export const WAITING_TITLE = translate('en', 'gate.waitingTitle');
export const WAITING_TEXT = translate('en', 'gate.waitingText');
export const DECLINED_TITLE = translate('en', 'gate.declinedTitle');
export const DECLINED_TEXT = translate('en', 'gate.declinedText');

/**
 * ARU-43: an account that isn't approved sees only this screen, whatever route it opens (deep links included).
 * Approved accounts, and signed-out visitors (the sign-in screen), get the app as usual.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const { currentUser } = useStore();
  const status = currentUser?.accessStatus;
  if (!currentUser || !status || status === 'approved') return <>{children}</>;
  return <AccessScreen declined={status === 'rejected'} />;
}

function AccessScreen({ declined }: { declined: boolean }) {
  const { loading, refresh, signOut } = useStore();
  const { t, tm } = useI18n();
  const { busy, error, run } = useAction();
  // ARU-75 AC 10: the same Delete account screen, in place (this screen replaces every route).
  const [deleting, setDeleting] = useState(false);
  if (deleting) {
    return (
      <SafeAreaView style={styles.screen}>
        <DeleteAccountForm showTitle onCancel={() => setDeleting(false)} />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 }}
        // Pull to refresh checks again while waiting (a declined account has nothing to check).
        refreshControl={
          declined ? undefined : <RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />
        }>
        <View style={{ gap: 8 }}>
          <Text style={[styles.h1, { textAlign: 'center' }]} accessibilityRole="header">
            {declined ? t('gate.declinedTitle') : t('gate.waitingTitle')}
          </Text>
          <Text style={[styles.body, { textAlign: 'center' }]}>
            {declined ? t('gate.declinedText') : t('gate.waitingText')}
          </Text>
        </View>
        <ErrorText error={tm(error)} />
        {!declined && (
          <Button title={busy ? t('gate.checking') : t('gate.checkAgain')} onPress={() => run(refresh)} disabled={busy} />
        )}
        <Button title={t('common.signOut')} variant="secondary" onPress={() => run(signOut)} disabled={busy} />
        <Button title={t('common.deleteAccount')} variant="danger" onPress={() => setDeleting(true)} disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}
