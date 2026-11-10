import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorText, Field, Segmented, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { PASSWORD_MIN } from '@/lib/password';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';
import { WORKSPACE_NAME_MAX } from '@/lib/workspace';

type Mode = 'signIn' | 'signUp';
/** ARU-146: what the new account does with a workspace; null until the user picks one. */
type WorkspaceKind = 'create' | 'join';

export default function SignInScreen() {
  const { ready, session, currentUser, dataLoaded, refresh, signIn, signUp, signOut, accountNotice } = useStore();
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceKind, setWorkspaceKind] = useState<WorkspaceKind | null>(null);
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
  const workspaceReady =
    (workspaceKind === 'create' && !!workspaceName.trim()) || (workspaceKind === 'join' && !!inviteCode.trim());
  const canSubmit =
    email.trim() && password.length >= PASSWORD_MIN && (mode === 'signIn' || (name.trim() && workspaceReady));

  function submitSignUp() {
    const choice =
      workspaceKind === 'create' ? { kind: 'create' as const, name: workspaceName } : { kind: 'join' as const, code: inviteCode };
    return signUp(name, email, password, choice);
  }

  const choiceOption = (kind: WorkspaceKind, label: string) => {
    const selected = workspaceKind === kind;
    return (
      <Pressable
        key={kind}
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ checked: selected }}
        testID={`workspace-${kind}`}
        onPress={() => setWorkspaceKind(kind)}
        style={[
          styles.input,
          { flexDirection: 'row', alignItems: 'center', gap: 10 },
          selected && { borderColor: colors.primary },
        ]}>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.muted} />
        <Text style={styles.body}>{label}</Text>
      </Pressable>
    );
  };

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
            <Field
              label={t('signIn.fullName')}
              placeholder={t('signIn.fullNamePlaceholder')}
              value={name}
              onChangeText={setName}
              autoComplete="name"
            />
          )}
          <Field
            label={t('signIn.email')}
            placeholder={t('signIn.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          <Field
            label={t('signIn.password')}
            placeholder={t('password.placeholder', { min: PASSWORD_MIN })}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          />
          {mode === 'signUp' && (
            // ARU-146 AC 1: create a workspace (and become its teacher) or join one with its invite code.
            <View style={{ gap: 8 }} accessibilityRole="radiogroup">
              {choiceOption('create', t('signIn.createWorkspace'))}
              {workspaceKind === 'create' && (
                <Field
                  label={t('signIn.workspaceName')}
                  placeholder={t('signIn.workspaceNamePlaceholder')}
                  value={workspaceName}
                  onChangeText={setWorkspaceName}
                  maxLength={WORKSPACE_NAME_MAX}
                  autoComplete="off"
                />
              )}
              {choiceOption('join', t('signIn.joinWorkspace'))}
              {workspaceKind === 'join' && (
                <Field
                  label={t('signIn.inviteCode')}
                  placeholder={t('signIn.inviteCodePlaceholder')}
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                />
              )}
            </View>
          )}
          {mode === 'signIn' && (
            // ARU-77: reset a forgotten password with a code sent by email.
            <Text
              accessibilityRole="link"
              style={[styles.caps, { color: colors.primary, fontSize: 14, alignSelf: 'flex-start', paddingVertical: 4 }]}
              onPress={() => router.push({ pathname: '/reset-password', params: { email: email.trim() } })}>
              {t('signIn.forgotPassword')}
            </Text>
          )}

          <ErrorText error={tm(error)} />
          <Button
            title={busy ? t('common.pleaseWait') : mode === 'signIn' ? t('signIn.submit') : t('signIn.createAccount')}
            disabled={!canSubmit || busy}
            onPress={() => run(() => (mode === 'signIn' ? signIn(email, password) : submitSignUp()))}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
