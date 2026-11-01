import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Switch, Text, View } from 'react-native';

import { Button, Card, ErrorText, styles } from '@/components/ui';
import { confirmDestructive } from '@/lib/confirm';
import { useStore } from '@/lib/store';
import { telegramBotUsername, telegramStartUrl, telegramSwitchesFor } from '@/lib/telegram';
import type { TelegramKind } from '@/lib/types';

/**
 * Telegram notifications on the Profile tab (ARU-48): connect the account to the Sham bot with a one-time link, turn
 * each notification type on or off, disconnect. Hidden when no bot username is configured; waiting accounts never see
 * the Profile tab (ARU-43 AccessGate), and the database refuses their codes anyway.
 */
export function TelegramCard() {
  const username = telegramBotUsername();
  if (!username) return null;
  return <TelegramCardBody username={username} />;
}

function TelegramCardBody({ username }: { username: string }) {
  const { currentUser, telegram, loadTelegram, createTelegramLinkCode, setTelegramNotification, disconnectTelegram } =
    useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Switches flip at once and go back if saving fails.
  const [pending, setPending] = useState<Partial<Record<TelegramKind, boolean>>>({});
  const connecting = useRef(false);

  // Coming back from Telegram: refetch when the tab is focused and when the app returns to the foreground.
  const refetch = useCallback(() => {
    loadTelegram().catch(() => {});
  }, [loadTelegram]);
  useFocusEffect(refetch);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  if (!currentUser) return null;

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function connect() {
    // One code per tap, even on a double tap.
    if (connecting.current) return;
    connecting.current = true;
    act(async () => {
      const code = await createTelegramLinkCode();
      await Linking.openURL(telegramStartUrl(username, code));
    }).finally(() => {
      connecting.current = false;
    });
  }

  function toggle(kind: TelegramKind, value: boolean) {
    setPending((p) => ({ ...p, [kind]: value }));
    setError(null);
    setTelegramNotification(kind, value)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not save. Please try again.'))
      .finally(() =>
        setPending((p) => {
          const { [kind]: _done, ...rest } = p;
          return rest;
        }),
      );
  }

  function disconnect() {
    act(async () => {
      const ok = await confirmDestructive('Disconnect Telegram', 'Stop Sham notifications in Telegram?', 'Disconnect');
      if (ok) await disconnectTelegram();
    });
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={styles.label} accessibilityRole="header">
        TELEGRAM NOTIFICATIONS
      </Text>
      {!telegram ? (
        <>
          <Text style={styles.body}>Get Sham notifications in Telegram.</Text>
          <ErrorText error={error} />
          <Button title={busy ? 'Opening Telegram…' : 'Connect Telegram'} onPress={connect} disabled={busy} />
        </>
      ) : (
        <>
          <Text style={[styles.body, { fontWeight: '600' }]}>Connected to Telegram</Text>
          {telegramSwitchesFor(currentUser.role).map(({ kind, label }) => (
            <View key={kind} style={[styles.row, { minHeight: 44 }]}>
              <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
              <Switch
                accessibilityLabel={label}
                value={pending[kind] ?? telegram.switches[kind]}
                onValueChange={(v) => toggle(kind, v)}
                disabled={busy || pending[kind] !== undefined}
              />
            </View>
          ))}
          <Text style={styles.muted}>{"You'll keep getting these after signing out of the app."}</Text>
          <ErrorText error={error} />
          <Button title="Disconnect" variant="secondary" onPress={disconnect} disabled={busy} />
        </>
      )}
    </Card>
  );
}
