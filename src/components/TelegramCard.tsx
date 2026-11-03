import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Switch, Text, View } from 'react-native';

import { Button, Card, ErrorText, styles } from '@/components/ui';
import { confirmDestructive } from '@/lib/confirm';
import { useStore } from '@/lib/store';
import { telegramBotUsername, telegramStartUrl, telegramSwitchesFor } from '@/lib/telegram';
import { colors } from '@/lib/theme';
import type { TelegramKind } from '@/lib/types';

/** ARU-79: where each user's collapsed/expanded choice for the card is kept on this device. */
export const telegramCardCollapsedKey = (userId: string) => `sham.telegramCard.collapsed.${userId}`;

// The last known choice per user for this app session, so coming back to the Profile tab shows it at once (no flash).
const collapsedCache = new Map<string, boolean>();

/** Test hook: forget the in-memory choices (they normally last for the app session). */
export function resetTelegramCardCollapsedCache() {
  collapsedCache.clear();
}

/**
 * ARU-79: the collapsed choice for `userId`. `undefined` while the saved choice is still loading (the card then shows
 * only its header, so a collapsed card never flashes open). Expanded by default and when storage fails (no error shown).
 */
function useCollapsed(userId: string | undefined): [boolean | undefined, () => void] {
  const [state, setState] = useState<{ userId?: string; collapsed?: boolean }>(() => ({
    userId,
    collapsed: userId ? collapsedCache.get(userId) : undefined,
  }));

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    if (collapsedCache.has(userId)) return;
    // Also catches a storage that throws instead of rejecting.
    Promise.resolve()
      .then(() => AsyncStorage.getItem(telegramCardCollapsedKey(userId)))
      .then((v) => (v === null ? false : v === '1'))
      .catch(() => false)
      .then((collapsed) => {
        if (cancelled) return;
        // A tap that happened while loading wins over the stored value.
        if (!collapsedCache.has(userId)) collapsedCache.set(userId, collapsed);
        setState({ userId, collapsed: collapsedCache.get(userId) });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggle = useCallback(() => {
    if (!userId) return;
    setState((prev) => {
      const current = prev.userId === userId ? (prev.collapsed ?? false) : (collapsedCache.get(userId) ?? false);
      const next = !current;
      collapsedCache.set(userId, next);
      Promise.resolve()
        .then(() => AsyncStorage.setItem(telegramCardCollapsedKey(userId), next ? '1' : '0'))
        .catch(() => {});
      return { userId, collapsed: next };
    });
  }, [userId]);

  // Another user signed in: use their choice from this session at once, or wait for their saved one.
  return [state.userId === userId ? state.collapsed : userId ? collapsedCache.get(userId) : undefined, toggle];
}

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
  // ARU-79: the header collapses the content. Error, busy and pending state stay here, so a save in progress still
  // finishes and an error still shows after expanding again.
  const [collapsed, toggleCollapsed] = useCollapsed(currentUser?.id);

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

  // Expanded unless the user chose to collapse; while the saved choice loads, only the header shows (AC 4, 5).
  const expanded = collapsed !== true;
  const showContent = collapsed === false;

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Telegram notifications"
        accessibilityState={{ expanded }}
        accessibilityHint={expanded ? 'Hides the Telegram settings' : 'Shows the Telegram settings'}
        onPress={toggleCollapsed}
        testID="telegram-card-header"
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text style={[styles.label, { flex: 1 }]}>TELEGRAM NOTIFICATIONS</Text>
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={20} color={colors.muted} />
      </Pressable>
      {!showContent ? null : !telegram ? (
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
                value={pending[kind] ?? telegram.switches[kind] ?? true}
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
