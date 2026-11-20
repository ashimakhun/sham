import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/AppText';
import { KeyboardForm } from '@/components/KeyboardForm';
import { NewPasswordFields } from '@/components/NewPasswordFields';
import { Button, ErrorText, Field, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { newPasswordReady } from '@/lib/password';
import { recoveryCodeReady } from '@/lib/recovery';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

function backToSignIn() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * ARU-165 AC 8–12: a forgotten password, without email. Username + recovery code + new password. On success this
 * device is signed in and the app opens with Save your recovery code (a new code) first.
 */
export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ username?: string }>();
  const { recoverPassword } = useStore();
  const { busy, error, run } = useAction();
  const { t, tm } = useI18n();
  const [username, setUsername] = useState(() => (typeof params.username === 'string' ? params.username : ''));
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // One request per tap, even before the disabled state has rendered.
  const inFlight = useRef(false);

  // Don't leave while the request runs (the password may already be changing).
  usePreventRemove(busy, () => {});

  const canSubmit = username.trim() !== '' && recoveryCodeReady(code) && newPasswordReady(password, confirm);

  function submit() {
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    run(async () => {
      try {
        await recoverPassword(username, code, password);
        // Signed in: back to the root, which opens the app (the Save screen shows first).
        router.replace('/');
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <KeyboardForm>
      {/* Same field settings as the sign-in screen's username (ARU-164 AC 6). */}
      <Field
        testID="forgot-username"
        label={t('signIn.username')}
        placeholder={t('signIn.usernamePlaceholder')}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        editable={!busy}
      />
      <View style={{ gap: 4 }}>
        <Field
          testID="forgot-code"
          label={t('recovery.codeLabel')}
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          editable={!busy}
        />
        <Text style={styles.muted}>{t('forgot.codeHint')}</Text>
      </View>
      <NewPasswordFields
        password={password}
        onPassword={setPassword}
        confirm={confirm}
        onConfirm={setConfirm}
        editable={!busy}
      />
      <ErrorText error={tm(error)} />
      <Button title={busy ? t('common.pleaseWait') : t('forgot.submit')} onPress={submit} disabled={!canSubmit || busy} />
      <Button title={t('forgot.backToSignIn')} variant="secondary" onPress={backToSignIn} disabled={busy} />
    </KeyboardForm>
  );
}
