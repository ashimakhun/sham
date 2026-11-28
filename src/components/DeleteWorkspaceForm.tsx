import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/AppText';

import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, Card, ErrorText, Field, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { workspaceNameMatches } from '@/lib/deleteAccount';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';
import { font } from '@/lib/fonts';

/**
 * ARU-180: the teacher's Delete workspace screen. Says what will happen, naming the workspace and the number of other
 * accounts (AC 2), asks for the workspace name (case and outer spaces ignored) and the password (AC 3). The server
 * checks everything again. After a successful deletion the store signs out and the sign-in screen says "Your account
 * and workspace were deleted" (AC 5); on an error the teacher stays here, signed in, with both fields kept (AC 4, 12).
 * An in-app screen (not a native alert), in a KeyboardForm so the keyboard never covers the button (AC 12).
 */
export function DeleteWorkspaceForm({ onCancel }: { onCancel: () => void }) {
  const { currentUser, deleteWorkspace, getWorkspaceDeletionSummary } = useStore();
  const { t } = useI18n();
  const [summary, setSummary] = useState<{ name: string; otherAccounts: number } | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  // Blocks a second tap before "Deleting…" has rendered, so a double tap sends one request (AC 12).
  const deleting = useRef(false);

  // AC 2: the name and count, read through a teacher-only function. Try again reloads.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    getWorkspaceDeletionSummary()
      .then((s) => {
        if (!live) return;
        setSummary(s);
        setLoadFailed(false);
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [getWorkspaceDeletionSummary, attempt]);
  const loadSummary = () => {
    setLoadFailed(false);
    setAttempt((n) => n + 1);
  };

  if (!currentUser) return null;

  const nameOk = !!summary && workspaceNameMatches(typedName, summary.name);
  const canDelete = !busy && nameOk && password.length > 0;

  const submit = () => {
    if (!canDelete || deleting.current) return;
    deleting.current = true;
    run(async () => {
      try {
        await deleteWorkspace(typedName, password);
      } finally {
        deleting.current = false;
      }
    });
  };

  return (
    <KeyboardForm>
      <Card>
        {summary ? (
          <Text style={styles.body} testID="delete-workspace-explanation">
            {/* The parts around the bold name are their own texts, as on Delete account (ARU-113). */}
            {t('deleteWorkspace.explanationBefore')}
            <Text style={{ ...font(600) }} testID="delete-workspace-name">
              {summary.name}
            </Text>
            {t('deleteWorkspace.explanationAfter')}
            {/* Edge case: a workspace with only the teacher has no sentence about other accounts. */}
            {summary.otherAccounts > 0 ? ' ' : ''}
            {summary.otherAccounts > 0 ? <OthersSentence count={summary.otherAccounts} /> : null}{' '}
            {t('deleteWorkspace.irreversible')}
          </Text>
        ) : loadFailed ? (
          <View style={{ gap: 10 }}>
            <Text style={[styles.body, { color: colors.danger }]} testID="delete-workspace-load-error">
              {t('deleteWorkspace.loadError')}
            </Text>
            <Button title={t('common.tryAgain')} variant="secondary" onPress={loadSummary} />
          </View>
        ) : summary === null ? (
          <Text style={[styles.body, { color: colors.danger }]} testID="delete-workspace-not-teacher">
            {t('deleteWorkspace.teacherOnly')}
          </Text>
        ) : (
          <ActivityIndicator />
        )}
      </Card>
      <Field
        label={t('deleteWorkspace.nameLabel')}
        accessibilityLabel={t('deleteWorkspace.nameLabel')}
        testID="delete-workspace-name-field"
        value={typedName}
        onChangeText={setTypedName}
        autoCapitalize="none"
        autoCorrect={false}
        // Edge case: password autofill must not fill this field.
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        editable={!busy}
        returnKeyType="next"
      />
      <Field
        label={t('deleteAccount.password')}
        accessibilityLabel={t('deleteAccount.password')}
        testID="delete-workspace-password-field"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <ErrorText error={error} />
      <View style={{ gap: 10 }}>
        <Button
          title={busy ? t('deleteAccount.deleting') : t('deleteWorkspace.submit')}
          variant="danger"
          disabled={!canDelete}
          onPress={submit}
        />
        <Button title={t('common.cancel')} variant="secondary" disabled={busy} onPress={onCancel} />
      </View>
    </KeyboardForm>
  );
}

/** "The <N> other accounts in it are deactivated: …", with the number in bold. */
function OthersSentence({ count }: { count: number }) {
  const { t } = useI18n();
  const text = t('deleteWorkspace.others', { count });
  const at = text.indexOf(String(count));
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Text style={{ ...font(600) }}>{count}</Text>
      {text.slice(at + String(count).length)}
    </>
  );
}
