import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorText, Field, Segmented, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

type Mode = 'signIn' | 'signUp';

export default function SignInScreen() {
  const { ready, session, currentUser, dataLoaded, refresh, signIn, signUp, signOut } = useStore();
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
            <Text style={styles.h1}>Sham</Text>
            <Text style={styles.muted}>Homework, checks and lessons in one place.</Text>
          </View>

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
