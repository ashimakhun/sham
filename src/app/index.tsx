import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorText, Field, Segmented, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { PASSWORD_MIN } from '@/lib/password';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

type Mode = 'signIn' | 'signUp';

export default function SignInScreen() {
  const { ready, session, currentUser, dataLoaded, refresh, signIn, signUp, signOut, accountNotice } = useStore();
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  const canSubmit = email.trim() && password.length >= PASSWORD_MIN && (mode === 'signIn' || name.trim());

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
          {mode === 'signIn' && (
            // ARU-77: reset a forgotten password with a code sent by email.
            <Text
              accessibilityRole="link"
              style={{ color: colors.primary, fontSize: 15, fontWeight: '600', alignSelf: 'flex-start', paddingVertical: 4 }}
              onPress={() => router.push({ pathname: '/reset-password', params: { email: email.trim() } })}>
              {t('signIn.forgotPassword')}
            </Text>
          )}

          <ErrorText error={tm(error)} />
          <Button
            title={busy ? t('common.pleaseWait') : mode === 'signIn' ? t('signIn.submit') : t('signIn.createAccount')}
            disabled={!canSubmit || busy}
            onPress={() => run(() => (mode === 'signIn' ? signIn(email, password) : signUp(name, email, password)))}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
