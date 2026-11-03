import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeleteAccountForm } from '@/components/DeleteAccountForm';
import { Button, ErrorText, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

export const WAITING_TITLE = 'Waiting for approval';
export const WAITING_TEXT = 'Your request to join has been sent to the teacher. You can use Sham once it is accepted.';
export const DECLINED_TITLE = 'Request declined';
export const DECLINED_TEXT = 'The teacher declined your request to join.';

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
            {declined ? DECLINED_TITLE : WAITING_TITLE}
          </Text>
          <Text style={[styles.body, { textAlign: 'center' }]}>{declined ? DECLINED_TEXT : WAITING_TEXT}</Text>
        </View>
        <ErrorText error={error} />
        {!declined && <Button title={busy ? 'Checking…' : 'Check again'} onPress={() => run(refresh)} disabled={busy} />}
        <Button title="Sign out" variant="secondary" onPress={() => run(signOut)} disabled={busy} />
        <Button title="Delete account" variant="danger" onPress={() => setDeleting(true)} disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}
