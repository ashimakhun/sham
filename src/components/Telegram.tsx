import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Switch, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Button, Card, ErrorText, styles } from '@/components/ui';
import { confirmDestructive } from '@/lib/confirm';
import { useStore } from '@/lib/store';
import { telegramBotUsername, telegramStartUrl, telegramSwitchesFor } from '@/lib/telegram';
import { colors } from '@/lib/theme';
import type { TelegramKind } from '@/lib/types';
import { font } from '@/lib/fonts';

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * ARU-101: on the Profile tab, Telegram notifications is one "Telegram notifications >" button that opens the
 * Telegram notifications page (src/app/telegram.tsx). It replaces the collapsible card from ARU-79; a collapsed choice
 * saved by that card is ignored. Hidden when no bot username is configured (ARU-48).
 */
export function TelegramButton() {
  // A double tap opens one page; the guard clears when Profile is focused again.
  const opening = useRef(false);
  useFocusEffect(
    useCallback(() => {
      opening.current = false;
    }, []),
  );
  if (!telegramBotUsername()) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Telegram notifications"
      accessibilityHint="Opens the Telegram notifications page"
      testID="telegram-button"
      onPress={() => {
        if (opening.current) return;
        opening.current = true;
        router.push('/telegram');
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.primarySoft, flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
        pressed && { opacity: 0.8 },
      ]}>
      <Text style={[styles.buttonText, { color: colors.primary, flex: 1 }]}>Telegram notifications</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/**
 * Telegram notifications settings (ARU-48), shown on the Telegram notifications page (ARU-101): connect the account to
 * the Sham bot with a one-time link, turn each notification type on or off, disconnect. Waiting accounts never get
 * here (ARU-43 AccessGate), and the database refuses their codes anyway.
 */
export function TelegramSettings({ username }: { username: string }) {
  const { currentUser, telegram, loadTelegram, createTelegramLinkCode, setTelegramNotification, disconnectTelegram } =
    useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A failed refetch shows on the page and keeps the last loaded state (ARU-101 edge cases).
  const [loadError, setLoadError] = useState<string | null>(null);
  // Switches flip at once and go back if saving fails.
  const [pending, setPending] = useState<Partial<Record<TelegramKind, boolean>>>({});
  const connecting = useRef(false);

  // Coming back from Telegram: refetch when the page is focused and when the app returns to the foreground.
  const refetch = useCallback(() => {
    loadTelegram()
      .then(() => setLoadError(null))
      .catch((e) => setLoadError(errorText(e, 'Could not load Telegram settings. Please try again.')));
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
      setError(errorText(e, 'Something went wrong. Please try again.'));
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
      .catch((e) => setError(errorText(e, 'Could not save. Please try again.')))
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

  const shownError = error ?? loadError;

  return (
    <Card style={{ gap: 10 }}>
      {!telegram ? (
        <>
          <Text style={styles.body}>Get Sham notifications in Telegram.</Text>
          <ErrorText error={shownError} />
          <Button title={busy ? 'Opening Telegram…' : 'Connect Telegram'} onPress={connect} disabled={busy} />
        </>
      ) : (
        <>
          <Text style={[styles.body, { ...font(500) }]}>Connected to Telegram</Text>
          {telegramSwitchesFor(currentUser.role).map(({ kind, label }) => (
            <View key={kind} style={[styles.row, { minHeight: 44 }]}>
              <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
              <Switch
                accessibilityLabel={label}
                value={pending[kind] ?? telegram.switches[kind] ?? true}
                onValueChange={(v) => toggle(kind, v)}
                disabled={busy || pending[kind] !== undefined}
              />
            </View>
          ))}
          <Text style={styles.muted}>{"You'll keep getting these after signing out of the app."}</Text>
          <ErrorText error={shownError} />
          <Button title="Disconnect" variant="secondary" onPress={disconnect} disabled={busy} />
        </>
      )}
    </Card>
  );
}
