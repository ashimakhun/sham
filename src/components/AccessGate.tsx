import { useRef, useState, type ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChooseUsernameScreen } from '@/components/ChooseUsernameScreen';
import { DeleteAccountForm } from '@/components/DeleteAccountForm';
import { LegalLinks } from '@/components/LegalLinks';
import { LegalUpdateScreen } from '@/components/LegalUpdateScreen';
import { SaveRecoveryCodeScreen } from '@/components/RecoveryCode';
import { Button, Card, ErrorText, Field, Segmented, styles } from '@/components/ui';
import { translate } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { WORKSPACE_NAME_MAX } from '@/lib/password';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

// ARU-108: the English texts (tests and other screens use them); the screen shows them in the chosen language.
export const WAITING_TITLE = translate('en', 'gate.waitingTitle');
export const WAITING_TEXT = translate('en', 'gate.waitingText');
export const DECLINED_TITLE = translate('en', 'gate.declinedTitle');
export const DECLINED_TEXT = translate('en', 'gate.declinedText');
export const DEACTIVATED_TITLE = translate('en', 'gate.deactivatedTitle');
export const DEACTIVATED_TEXT = translate('en', 'gate.deactivatedText');

/**
 * ARU-43: an account that isn't approved sees only this screen, whatever route it opens (deep links included).
 * Approved accounts, and signed-out visitors (the sign-in screen), get the app as usual. ARU-168: Choose a username
 * comes before all of it, then ARU-165's Save your recovery code. ARU-159's "We've updated our Terms" comes first.
 * ARU-180 AC 9: an account whose workspace was deleted (deactivated) sees only "Your workspace was deleted"; ARU-181
 * adds the Join a workspace / Create a workspace card there.
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
  return <AccessScreen kind={status === 'rejected' ? 'declined' : status === 'deactivated' ? 'deactivated' : 'waiting'} />;
}

function AccessScreen({ kind }: { kind: 'waiting' | 'declined' | 'deactivated' }) {
  const declined = kind === 'declined';
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
        // Pull to refresh checks again while waiting, and for a deactivated account (ARU-180 AC 9); a declined account
        // has nothing to check.
        refreshControl={
          declined ? undefined : <RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />
        }
        // ARU-181 AC 11: the keyboard never covers the field or the button and can be dismissed (as KeyboardForm).
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets>
        <View style={{ gap: 8 }}>
          <Text style={[styles.h1, { textAlign: 'center' }]} accessibilityRole="header">
            {t(kind === 'declined' ? 'gate.declinedTitle' : kind === 'deactivated' ? 'gate.deactivatedTitle' : 'gate.waitingTitle')}
          </Text>
          <Text style={[styles.body, { textAlign: 'center' }]}>
            {t(kind === 'declined' ? 'gate.declinedText' : kind === 'deactivated' ? 'gate.deactivatedText' : 'gate.waitingText')}
          </Text>
        </View>
        {kind === 'deactivated' && <RejoinCard disabled={busy} />}
        <ErrorText error={tm(error)} />
        {kind === 'waiting' && (
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

type Choice = 'create' | 'join';

/**
 * ARU-181 AC 1-5, 9, 10: join another workspace with its invite code (as a waiting student) or create one (as its
 * teacher). The same switch, fields and rules as at sign-up (src/app/index.tsx), set to Join. On success (or "You
 * already belong to a workspace.") the store reloads and the gate shows the new status; the fields keep what was typed.
 */
function RejoinCard({ disabled }: { disabled: boolean }) {
  const { rejoinWorkspace } = useStore();
  const { t, tm } = useI18n();
  const { busy, error, run } = useAction();
  const [choice, setChoice] = useState<Choice>('join');
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  // AC 2: a double tap sends one request (the busy flag only applies after the next render).
  const sending = useRef(false);
  const filled = choice === 'create' ? workspaceName.trim() !== '' : inviteCode.trim() !== '';
  const submit = () => {
    if (sending.current || !filled) return;
    sending.current = true;
    run(() =>
      rejoinWorkspace(choice === 'create' ? { kind: 'create', name: workspaceName } : { kind: 'join', code: inviteCode }),
    ).finally(() => {
      sending.current = false;
    });
  };
  const label =
    choice === 'create' ? (busy ? t('gate.creating') : t('gate.create')) : busy ? t('gate.joining') : t('gate.join');
  return (
    <Card testID="rejoin-card" style={{ gap: 12 }}>
      <Segmented<Choice>
        value={choice}
        onChange={setChoice}
        options={[
          { value: 'create', label: t('signIn.workspaceCreate') },
          { value: 'join', label: t('signIn.workspaceJoin') },
        ]}
      />
      {choice === 'create' ? (
        <Field
          label={t('signIn.workspaceName')}
          placeholder={t('signIn.workspaceNamePlaceholder')}
          value={workspaceName}
          onChangeText={setWorkspaceName}
          maxLength={WORKSPACE_NAME_MAX}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      ) : (
        <Field
          label={t('signIn.inviteCode')}
          placeholder={t('signIn.inviteCodePlaceholder')}
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      )}
      <ErrorText error={tm(error)} />
      <Button title={label} onPress={submit} disabled={disabled || busy || !filled} />
    </Card>
  );
}
