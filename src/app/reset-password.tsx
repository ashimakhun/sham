import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';

import { KeyboardForm } from '@/components/KeyboardForm';
import { NewPasswordFields } from '@/components/NewPasswordFields';
import { Button, ErrorText, Field, styles } from '@/components/ui';
import { notify } from '@/lib/confirm';
import {
  cleanCode,
  codeReady,
  codeSentMessage,
  newPasswordReady,
  PASSWORD_CHANGED,
  RESEND_COOLDOWN_S,
} from '@/lib/password';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

type Pending = 'send' | 'resend' | 'reset' | null;

function backToSignIn() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** Seconds left of the "Send a new code" cooldown, counting down once a second. */
function useCooldown(sentAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sentAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sentAt]);
  if (sentAt === null) return 0;
  // Until the first tick, `now` can be older than the send: that counts as no time passed.
  const elapsed = Math.max(0, Math.floor((now - sentAt) / 1000));
  return Math.max(0, RESEND_COOLDOWN_S - elapsed);
}

/**
 * ARU-77: a forgotten password. Step 1 sends a code to the email (same answer whether or not it has an account);
 * step 2 takes the code and a new password, and signs the user in only once the new password is saved.
 */
export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { requestPasswordReset, resetPasswordWithCode } = useStore();
  const { busy, error, run, clearError } = useAction();
  const [email, setEmail] = useState(() => (typeof params.email === 'string' ? params.email : ''));
  // The trimmed address the code went to; set once a code was sent (the code step).
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  // One request per tap, even before the disabled state has rendered.
  const inFlight = useRef(false);
  const [done, setDone] = useState(false);
  const secondsLeft = useCooldown(sentAt);

  // Don't leave half-way through a reset request (the code may already be used); any other time is fine (AC 10).
  usePreventRemove(pending === 'reset' && !done, () => {});

  useEffect(() => {
    if (!done) return;
    notify(PASSWORD_CHANGED);
    // The sign-in screen underneath now opens the app (Homework, or the waiting / declined screen).
    backToSignIn();
  }, [done]);

  function request(kind: Exclude<Pending, null>, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(kind);
    run(async () => {
      try {
        await action();
      } finally {
        inFlight.current = false;
        setPending(null);
      }
    });
  }

  const send = (kind: 'send' | 'resend', to: string) =>
    request(kind, async () => {
      await requestPasswordReset(to);
      setSentTo(to);
      setSentAt(Date.now());
    });

  const label = (kind: Exclude<Pending, null>, title: string) => (pending === kind ? 'Please wait…' : title);

  if (sentTo === null) {
    return (
      <KeyboardForm>
        <Text style={styles.muted}>
          {"Enter the email you signed up with. We'll send you a code to set a new password."}
        </Text>
        <Field
          testID="reset-email"
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <ErrorText error={error} />
        <Button
          title={label('send', 'Send code')}
          disabled={!email.trim() || busy}
          onPress={() => send('send', email.trim())}
        />
        <Button title="Back to sign in" variant="secondary" onPress={backToSignIn} />
      </KeyboardForm>
    );
  }

  const canReset = codeReady(code) && newPasswordReady(password, confirm);

  return (
    <KeyboardForm>
      <Text style={styles.body}>{codeSentMessage(sentTo)}</Text>
      <Field
        testID="reset-code"
        label="Code"
        placeholder="123456"
        value={code}
        onChangeText={(t) => setCode(cleanCode(t))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={10}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
      />
      <NewPasswordFields password={password} onPassword={setPassword} confirm={confirm} onConfirm={setConfirm} />
      <ErrorText error={error} />
      <Button
        title={label('reset', 'Reset password')}
        disabled={!canReset || busy || done}
        onPress={() =>
          request('reset', async () => {
            await resetPasswordWithCode(sentTo, code, password);
            setDone(true);
          })
        }
      />
      <Button
        title={pending === 'resend' ? 'Please wait…' : secondsLeft > 0 ? `Send a new code (${secondsLeft}s)` : 'Send a new code'}
        variant="secondary"
        disabled={secondsLeft > 0 || busy || done}
        onPress={() => {
          clearError();
          send('resend', sentTo);
        }}
      />
      <Button title="Back to sign in" variant="secondary" disabled={pending === 'reset' || done} onPress={backToSignIn} />
    </KeyboardForm>
  );
}
