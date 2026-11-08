import { useRef, useState } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/AppText';

import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, Card, ErrorText, Field, styles } from '@/components/ui';
import {
  DELETE_EXPLANATION_AFTER,
  DELETE_EXPLANATION_BEFORE,
  DELETED_ACCOUNT,
  ownedCoursesProblem,
  TEACHER_CANT_DELETE,
} from '@/lib/deleteAccount';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';
import { font } from '@/lib/fonts';

/**
 * ARU-75: the Delete account screen's body, shared by the route (opened from the Profile tab) and the waiting /
 * declined screen (AC 10). Explains what happens (AC 2), asks for the password, and is disabled for a course owner
 * (AC 6). The server checks everything again. After a successful deletion the store signs out and the sign-in screen
 * shows "Your account was deleted"; on an error the user stays here, signed in, with the password still typed.
 * An in-app screen (not a native alert), in a KeyboardForm so the keyboard never covers the button (AC 13).
 */
export function DeleteAccountForm({ onCancel, showTitle = false }: { onCancel: () => void; showTitle?: boolean }) {
  const { currentUser, courses, deleteAccount } = useStore();
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  // Blocks a second tap before "Deleting…" has rendered, so a double tap sends one request (AC 12).
  const deleting = useRef(false);
  if (!currentUser) return null;

  const blocked =
    currentUser.role === 'teacher'
      ? TEACHER_CANT_DELETE
      : ownedCoursesProblem(courses.filter((c) => c.createdById === currentUser.id).map((c) => c.title));
  const canDelete = !busy && !blocked && password.length > 0;

  const submit = () => {
    if (!canDelete || deleting.current) return;
    deleting.current = true;
    run(async () => {
      try {
        await deleteAccount(password);
      } finally {
        deleting.current = false;
      }
    });
  };

  return (
    <KeyboardForm>
      {showTitle && (
        <Text style={styles.h1} accessibilityRole="header">
          Delete account
        </Text>
      )}
      <Card>
        <Text style={styles.body} testID="delete-account-explanation">
          {DELETE_EXPLANATION_BEFORE}
          <Text style={{ ...font(600) }}>{DELETED_ACCOUNT}</Text>
          {DELETE_EXPLANATION_AFTER}
        </Text>
      </Card>
      {blocked ? (
        <Text style={[styles.body, { color: colors.danger }]} testID="delete-account-blocked">
          {blocked}
        </Text>
      ) : null}
      <Field
        label="Password"
        accessibilityLabel="Password"
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
          title={busy ? 'Deleting…' : 'Delete my account'}
          variant="danger"
          disabled={!canDelete}
          onPress={submit}
        />
        <Button title="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
      </View>
    </KeyboardForm>
  );
}
