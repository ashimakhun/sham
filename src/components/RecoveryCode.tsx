import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/AppText';
import { Button, ErrorText, styles, ThemedSwitch } from '@/components/ui';
import { translate } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { CODE_FONT, RecoveryCodeReplaced } from '@/lib/recovery';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

// The English texts (tests use them); the screens show them in the chosen language.
export const SAVE_RECOVERY_TITLE = translate('en', 'recovery.saveTitle');
export const SAVE_RECOVERY_TEXT = translate('en', 'recovery.saveText');

/**
 * ARU-165 AC 1–2: the code (monospaced, selectable), Copy with a short "Copied", and the "I saved it" switch. Shared by
 * Save your recovery code and New recovery code.
 */
export function RecoveryCodeCard({
  code,
  saved,
  onSaved,
  disabled,
}: {
  code: string;
  saved: boolean;
  onSaved: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  // The code "Copied" belongs to: a new code (two devices) hides it.
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const copied = copiedCode === code;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      // AC 2: with dashes, as shown.
      await Clipboard.setStringAsync(code);
    } catch {
      return; // the clipboard isn't available: no "Copied"
    }
    setCopiedCode(code);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiedCode(null), 2000);
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={[styles.card, { gap: 8 }]} testID="recovery-code-card">
        <Text style={styles.label}>{t('recovery.codeLabel').toUpperCase()}</Text>
        <Text
          selectable
          testID="recovery-code"
          accessibilityLabel={`${t('recovery.codeLabel')}: ${code}`}
          style={{ fontFamily: CODE_FONT, fontSize: 22, letterSpacing: 1, color: colors.text, textAlign: 'center' }}>
          {code}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('recovery.copyA11y')}
            hitSlop={6}
            onPress={copy}
            testID="recovery-copy"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              minHeight: 32,
              paddingHorizontal: 12,
              borderRadius: 16,
              backgroundColor: colors.primarySoft,
            }}>
            <Ionicons name="copy-outline" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 14 }}>{t('recovery.copy')}</Text>
          </Pressable>
          {copied && (
            <Text style={{ color: colors.success, fontSize: 14 }} accessibilityLiveRegion="polite" testID="recovery-copied">
              {t('recovery.copied')}
            </Text>
          )}
        </View>
      </View>
      <View style={[styles.row, { alignItems: 'center' }]}>
        <Text style={[styles.body, { flex: 1 }]}>{t('recovery.saved')}</Text>
        <ThemedSwitch
          testID="recovery-saved-switch"
          accessibilityLabel={t('recovery.saved')}
          value={saved}
          onValueChange={onSaved}
          disabled={disabled}
        />
      </View>
    </View>
  );
}

/**
 * ARU-165 AC 1–4: the full screen an account with a username but no saved recovery code sees before anything else
 * (AccessGate: after Choose a username, before the waiting / declined screen and the tabs, deep links included).
 * No Back or Skip: Android's back button does nothing here.
 */
export function SaveRecoveryCodeScreen() {
  const { getRecoveryCode, saveRecoveryCode, signOut } = useStore();
  const { t, tm } = useI18n();
  const { busy, error, run } = useAction();
  const [code, setCode] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const load = async () => {
    setLoadFailed(false);
    try {
      setCode(await getRecoveryCode());
    } catch {
      setLoadFailed(true);
    }
  };
  useEffect(() => {
    // Once per screen: the store keeps the code for this app session.
    getRecoveryCode().then(setCode, () => setLoadFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onContinue() {
    if (!code || !saved) return;
    run(async () => {
      try {
        await saveRecoveryCode(code);
      } catch (e) {
        // Edge case (two devices): a fresh code is shown; tick the switch again for it. Offline: the same code stays.
        if (e instanceof RecoveryCodeReplaced) {
          setSaved(false);
          if (e.fresh) setCode(e.fresh);
          else {
            setCode(null);
            setLoadFailed(true);
          }
        }
        throw e;
      }
    });
  }

  return (
    <SafeAreaView style={styles.screen} testID="save-recovery-code">
      {/* Long Russian texts wrap; the screen scrolls on small phones. */}
      <ScrollView contentContainerStyle={[styles.content, { gap: 16, flexGrow: 1, justifyContent: 'center' }]}>
        <View style={{ gap: 8 }}>
          <Text style={[styles.h1, { textAlign: 'center' }]} accessibilityRole="header">
            {t('recovery.saveTitle')}
          </Text>
          <Text style={[styles.body, { textAlign: 'center' }]}>{t('recovery.saveText')}</Text>
        </View>
        {code ? (
          <RecoveryCodeCard code={code} saved={saved} onSaved={setSaved} disabled={busy} />
        ) : loadFailed ? (
          <View style={{ gap: 12 }}>
            <Text style={[styles.muted, { textAlign: 'center' }]}>{t('recovery.loadFailed')}</Text>
            <Button title={t('common.tryAgain')} onPress={load} />
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
        <ErrorText error={tm(error)} />
        <Button
          title={busy ? t('common.saving') : t('recovery.continue')}
          onPress={onContinue}
          disabled={!code || !saved || busy}
        />
        <Button title={t('common.signOut')} variant="secondary" onPress={() => run(signOut)} disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}
