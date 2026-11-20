import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorText, Field, Segmented, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { PASSWORD_MIN, WORKSPACE_NAME_MAX } from '@/lib/password';
import { NAME_MAX } from '@/lib/profileName';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';
import { isValidUsername, USERNAME_MAX } from '@/lib/username';

type Mode = 'signIn' | 'signUp';
/** ARU-146: nothing is chosen until the user picks one. */
type Choice = '' | 'create' | 'join';

export default function SignInScreen() {
  const { ready, session, currentUser, dataLoaded, refresh, signIn, signUp, signOut, accountNotice } = useStore();
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  // ARU-164: the username (or, when signing in, an older account's email: AC 8).
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [choice, setChoice] = useState<Choice>('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const { busy, error, run } = useAction();
  const { t, tm } = useI18n();

  if (currentUser) return <Redirect href="/homework" />;

  if (!ready || (session && !dataLoaded)) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (session) {
    // Signed in, but no profile row came back (network error or the sign-up trigger failed).
    return (
      <View style={[styles.screen, { justifyContent: 'center', padding: 24, gap: 12 }]}>
        <Text style={[styles.muted, { textAlign: 'center' }]}>{t('signIn.profileFailed')}</Text>
        <ErrorText error={tm(error)} />
        <Button title={t('common.tryAgain')} onPress={() => run(refresh)} disabled={busy} />
        <Button title={t('common.signOut')} variant="secondary" onPress={() => run(signOut)} disabled={busy} />
      </View>
    );
  }

  // ARU-146 AC 1: Create account also needs a workspace choice whose field has something other than spaces.
  const choiceReady =
    (choice === 'create' && workspaceName.trim() !== '') || (choice === 'join' && inviteCode.trim() !== '');
  // ARU-164 AC 2: the sign-up rules apply to Create account only; signing in takes any non-empty text (note 5).
  const usernameBroken = mode === 'signUp' && username.trim() !== '' && !isValidUsername(username);
  const usernameReady = mode === 'signIn' ? username.trim() !== '' : isValidUsername(username);
  const canSubmit =
    usernameReady && password.length >= PASSWORD_MIN && (mode === 'signIn' || (name.trim() && name.trim().length <= NAME_MAX && choiceReady));

  function submit() {
    if (mode === 'signIn') return signIn(username, password);
    return signUp(
      name,
      username,
      password,
      choice === 'create' ? { kind: 'create', name: workspaceName } : { kind: 'join', code: inviteCode },
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.content, { gap: 16 }]} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 4, marginVertical: 24 }}>
            <Image
              source={require('../../assets/logo.png')}
              style={{ width: 72, height: 76, marginBottom: 12, alignSelf: 'center' }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              accessible={false}
              testID="app-logo"
            />
            <Text style={[styles.h1, { textAlign: 'center' }]}>Sham</Text>
            <Text style={[styles.muted, { textAlign: 'center' }]}>{t('signIn.tagline')}</Text>
          </View>

          {/* ARU-75: after this account was deleted (here or on another device). */}
          {accountNotice ? (
            <Text style={[styles.body, { color: colors.success }]} testID="account-notice" accessibilityRole="alert">
              {tm(accountNotice)}
            </Text>
          ) : null}

          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'signIn', label: t('signIn.modeSignIn') },
              { value: 'signUp', label: t('signIn.modeSignUp') },
            ]}
          />

          {mode === 'signUp' && (
            // ARU-164 AC 1: a display name, not a real name.
            <View style={{ gap: 4 }}>
              <Field
                label={t('signIn.displayName')}
                placeholder={t('signIn.displayNamePlaceholder')}
                value={name}
                onChangeText={setName}
                autoComplete="nickname"
                maxLength={NAME_MAX}
                accessibilityHint={t('signIn.displayNameHint')}
              />
              <Text style={styles.muted}>{t('signIn.displayNameHint')}</Text>
            </View>
          )}
          {/* ARU-164 AC 6: the username, with no autocapitalisation or autocorrect, autofilled as a username. */}
          <View style={{ gap: 4 }}>
            <Field
              label={t('signIn.username')}
              placeholder={t('signIn.usernamePlaceholder')}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              maxLength={mode === 'signUp' ? USERNAME_MAX : undefined}
              testID="username-field"
            />
            {usernameBroken ? (
              <Text style={{ color: colors.danger, fontSize: 14 }} testID="username-rule" accessibilityLiveRegion="polite">
                {t('signIn.usernameRule')}
              </Text>
            ) : null}
            {mode === 'signIn' ? (
              // ARU-164 AC 8: older accounts still sign in with their email until ARU-168.
              <Text style={styles.muted} testID="legacy-email-hint">
                {t('signIn.legacyEmailHint')}
              </Text>
            ) : null}
          </View>
          <Field
            label={t('signIn.password')}
            placeholder={t('password.placeholder', { min: PASSWORD_MIN })}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          />
          {mode === 'signUp' && (
            // ARU-146: create a workspace (and become its teacher) or join one with its invite code.
            <View style={{ gap: 12 }} testID="workspace-choice">
              <Segmented<Choice>
                value={choice}
                onChange={setChoice}
                options={[
                  { value: 'create', label: t('signIn.workspaceCreate') },
                  { value: 'join', label: t('signIn.workspaceJoin') },
                ]}
              />
              {choice === 'create' && (
                <Field
                  label={t('signIn.workspaceName')}
                  placeholder={t('signIn.workspaceNamePlaceholder')}
                  value={workspaceName}
                  onChangeText={setWorkspaceName}
                  maxLength={WORKSPACE_NAME_MAX}
                />
              )}
              {choice === 'join' && (
                <Field
                  label={t('signIn.inviteCode')}
                  placeholder={t('signIn.inviteCodePlaceholder')}
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  maxLength={20}
                />
              )}
            </View>
          )}
          {/* ARU-165 AC 8: Forgot password? is back, with a recovery code instead of email (ARU-164 had hidden it). The
              username typed here is filled in. */}
          {mode === 'signIn' && (
            <Text
              accessibilityRole="link"
              testID="forgot-password-link"
              style={[styles.caps, { color: colors.primary, fontSize: 14, alignSelf: 'flex-start', paddingVertical: 4 }]}
              onPress={() =>
                router.push({ pathname: '/forgot-password', params: username.includes('@') ? {} : { username: username.trim() } })
              }>
              {t('signIn.forgotPassword')}
            </Text>
          )}

          <ErrorText error={tm(error)} />
          <Button
            title={busy ? t('common.pleaseWait') : mode === 'signIn' ? t('signIn.submit') : t('signIn.createAccount')}
            disabled={!canSubmit || busy}
            onPress={() => run(submit)}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
