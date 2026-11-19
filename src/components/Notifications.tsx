import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Button, Card, ErrorText, styles, ThemedSwitch } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { askPushPermission, pushPermission, type PushPermission, pushSupported } from '@/lib/push';
import { useStore } from '@/lib/store';
import { telegramSwitchesFor } from '@/lib/telegram';
import { colors } from '@/lib/theme';
import type { TelegramKind } from '@/lib/types';

// The fallback is passed in already translated; e.message is shown through ErrorText, which translates app messages.
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * ARU-166 AC 7: on the Profile tab, "Notifications >" opens the Notifications page (src/app/notifications.tsx). It sits
 * where "Telegram notifications >" was and is shown for every role, whether or not a Telegram bot is configured.
 */
export function NotificationsButton() {
  const { t } = useI18n();
  // A double tap opens one page; the guard clears when Profile is focused again.
  const opening = useRef(false);
  useFocusEffect(
    useCallback(() => {
      opening.current = false;
    }, []),
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('notifications.title')}
      accessibilityHint={t('notifications.buttonHint')}
      testID="notifications-button"
      onPress={() => {
        if (opening.current) return;
        opening.current = true;
        router.push('/notifications');
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.primarySoft, flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
        pressed && { opacity: 0.8 },
      ]}>
      <Text style={[styles.buttonText, { color: colors.primary, flex: 1 }]}>{t('notifications.title')}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/**
 * ARU-166: the Notifications page. One switch per kind the role gets (today's order and labels), saved on the account.
 * In an installed build the first open asks for permission (AC 1) and registers this phone (AC 2); with notifications
 * off for Sham it says so with Open settings (AC 3); in Expo Go and on the web it says push needs the installed app
 * (AC 6). The switches work in every case.
 */
export function NotificationSettings() {
  const { currentUser, notificationSettings, loadNotificationSettings, setNotification, syncPushDevice } = useStore();
  const { t, lang } = useI18n();
  const supported = pushSupported();
  const [permission, setPermission] = useState<PushPermission | null>(supported ? null : 'unsupported');
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Switches flip at once and go back if saving fails (AC 8).
  const [pending, setPending] = useState<Partial<Record<TelegramKind, boolean>>>({});

  const refresh = useCallback(
    (ask: boolean) => {
      loadNotificationSettings()
        .then(() => setLoadError(null))
        .catch((e) => setLoadError(errorText(e, t('notifications.loadFailed'))));
      if (!supported) return;
      // AC 1: the first open of this page asks (once: afterwards the permission is no longer undetermined).
      (ask ? askPushPermission() : pushPermission())
        .then((p) => {
          setPermission(p);
          return syncPushDevice();
        })
        .catch(() => {});
    },
    [loadNotificationSettings, supported, syncPushDevice, t],
  );
  useFocusEffect(useCallback(() => refresh(true), [refresh]));
  // Back from the phone's settings: read the permission again (never asks).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh(false);
    });
    return () => sub.remove();
  }, [refresh]);

  if (!currentUser) return null;

  function toggle(kind: TelegramKind, value: boolean) {
    setPending((p) => ({ ...p, [kind]: value }));
    setError(null);
    // AC 1: turning a switch on asks when Sham has never asked on this phone.
    if (value && permission === 'undetermined') {
      askPushPermission()
        .then((p) => {
          setPermission(p);
          return syncPushDevice();
        })
        .catch(() => {});
    }
    setNotification(kind, value)
      .catch(() => setError(t('notifications.saveFailed')))
      .finally(() =>
        setPending((p) => {
          const { [kind]: _done, ...rest } = p;
          return rest;
        }),
      );
  }

  const shownError = error ?? loadError;

  return (
    <Card style={{ gap: 10 }}>
      {permission === 'unsupported' && (
        <Text style={styles.muted} testID="notifications-unsupported">
          {t('notifications.installedAppOnly')}
        </Text>
      )}
      {permission === 'denied' && (
        <View style={{ gap: 8 }} testID="notifications-off">
          <Text style={styles.body}>{t('notifications.offInSettings')}</Text>
          <Button
            title={t('notifications.openSettings')}
            variant="secondary"
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
          />
        </View>
      )}
      {telegramSwitchesFor(currentUser.role, lang).map(({ kind, label }) => (
        <View key={kind} style={[styles.row, { minHeight: 44 }]}>
          <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
          <ThemedSwitch
            accessibilityLabel={label}
            value={pending[kind] ?? notificationSettings?.[kind] ?? true}
            onValueChange={(v) => toggle(kind, v)}
            disabled={pending[kind] !== undefined}
          />
        </View>
      ))}
      <ErrorText error={shownError} />
    </Card>
  );
}
