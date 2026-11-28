import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChooseUsernameScreen } from '@/components/ChooseUsernameScreen';
import { DeleteAccountForm } from '@/components/DeleteAccountForm';
import { LegalLinks } from '@/components/LegalLinks';
import { LegalUpdateScreen } from '@/components/LegalUpdateScreen';
import { SaveRecoveryCodeScreen } from '@/components/RecoveryCode';
import { Button, ErrorText, styles } from '@/components/ui';
import { translate } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

// ARU-108: the English texts (tests and other screens use them); the screen shows them in the chosen language.
export const WAITING_TITLE = translate('en', 'gate.waitingTitle');
export const WAITING_TEXT = translate('en', 'gate.waitingText');
export const DECLINED_TITLE = translate('en', 'gate.declinedTitle');
export const DECLINED_TEXT = translate('en', 'gate.declinedText');

/**
 * ARU-43: an account that isn't approved sees only this screen, whatever route it opens (deep links included).
 * Approved accounts, and signed-out visitors (the sign-in screen), get the app as usual. ARU-168: Choose a username
 * comes before all of it, then ARU-165's Save your recovery code. ARU-159's "We've updated our Terms" comes first.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const { currentUser, needsUsername, needsRecoveryCode, needsLegalAgreement } = useStore();
  // ARU-159 AC 8: a new version of the Privacy Policy / Terms of Use (or none agreed yet) comes before everything else.
  // It replaces the routes without redirecting, so after I agree the route underneath (a deep link) renders.
  if (needsLegalAgreement) return <LegalUpdateScreen />;
  // ARU-168 AC 1: an older account (no username) chooses one first, before the waiting / declined screen and the tabs.
  if (needsUsername) return <ChooseUsernameScreen />;
  // ARU-165 AC 1: then, with a username but no saved recovery code, Save your recovery code (before the waiting /
  // declined screen and the tabs, deep links included).
  if (needsRecoveryCode) return <SaveRecoveryCodeScreen />;
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
        {/* ARU-159 AC 7: the documents and Contact us, for waiting and declined accounts too. */}
        <LegalLinks />
      </ScrollView>
    </SafeAreaView>
  );
}
