import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorText, Field, Segmented, styles } from '@/components/ui';
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
        <Text style={[styles.muted, { textAlign: 'center' }]}>Could not load your profile.</Text>
        <ErrorText error={error} />
        <Button title="Try again" onPress={() => run(refresh)} disabled={busy} />
        <Button title="Sign out" variant="secondary" onPress={() => run(signOut)} disabled={busy} />
      </View>
    );
  }

  const canSubmit = email.trim() && password.length >= 6 && (mode === 'signIn' || name.trim());

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.content, { gap: 16 }]} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 4, marginVertical: 24 }}>
            <Image
              source={require('../../assets/logo.png')}
              style={{ width: 72, height: 76, marginBottom: 12 }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              accessible={false}
              testID="app-logo"
            />
            <Text style={styles.h1}>Sham</Text>
            <Text style={styles.muted}>Homework, checks and lessons in one place.</Text>
          </View>

          {/* ARU-75: after this account was deleted (here or on another device). */}
          {accountNotice ? (
            <Text style={[styles.body, { color: colors.success }]} testID="account-notice" accessibilityRole="alert">
              {accountNotice}
            </Text>
          ) : null}

          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'signIn', label: 'Sign in' },
              { value: 'signUp', label: 'Create account' },
            ]}
          />

          {mode === 'signUp' && (
            <Field label="Full name" placeholder="Dana Serikova" value={name} onChangeText={setName} autoComplete="name" />
          )}
          <Field
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          <Field
            label="Password"
            placeholder="At least 6 characters"
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
              Forgot password?
            </Text>
          )}

          <ErrorText error={error} />
          <Button
            title={busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
            disabled={!canSubmit || busy}
            onPress={() => run(() => (mode === 'signIn' ? signIn(email, password) : signUp(name, email, password)))}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
