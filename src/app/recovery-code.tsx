import { router, usePreventRemove } from 'expo-router';
import { useRef, useState } from 'react';

import { Text } from '@/components/AppText';
import { KeyboardForm } from '@/components/KeyboardForm';
import { RecoveryCodeCard } from '@/components/RecoveryCode';
import { Button, ErrorText, Field, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { RecoveryCodeReplaced } from '@/lib/recovery';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/profile');
}

/**
 * ARU-165 AC 5–7: Profile → Recovery code. The current password is checked on the server (new-recovery-code); the
 * old code stops working at once and the new one is shown with Copy, I saved it and Done. Leaving without Done leaves
 * it unsaved: the Save screen shows a new code on the next load (AC 4).
 */
export default function NewRecoveryCodeScreen() {
  const { currentUser, makeNewRecoveryCode, saveRecoveryCode } = useStore();
  const { busy, error, run } = useAction();
  const { t, tm } = useI18n();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);

  // Not while the request runs (the code may already be replaced on the server).
  usePreventRemove(busy, () => {});

  if (!currentUser) return null;

  function make() {
    if (!password || inFlight.current) return;
    inFlight.current = true;
    run(async () => {
      try {
        setCode(await makeNewRecoveryCode(password));
        setPassword('');
        setSaved(false);
      } finally {
        inFlight.current = false;
      }
    });
  }

  function done() {
    if (!code || !saved) return;
    run(async () => {
      try {
        await saveRecoveryCode(code);
        leave();
      } catch (e) {
        // Edge case (two devices): a fresh code is shown; tick the switch again for it.
        if (e instanceof RecoveryCodeReplaced && e.fresh) {
          setCode(e.fresh);
          setSaved(false);
        }
        throw e;
      }
    });
  }

  if (code) {
    return (
      <KeyboardForm>
        <RecoveryCodeCard code={code} saved={saved} onSaved={setSaved} disabled={busy} />
        <ErrorText error={tm(error)} />
        <Button title={busy ? t('common.saving') : t('recovery.done')} onPress={done} disabled={!saved || busy} />
      </KeyboardForm>
    );
  }

  return (
    <KeyboardForm>
      <Text style={styles.body}>{t('recovery.newText')}</Text>
      <Field
        testID="recovery-current-password"
        label={t('password.current')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        editable={!busy}
      />
      <ErrorText error={tm(error)} />
      <Button title={busy ? t('common.pleaseWait') : t('recovery.make')} onPress={make} disabled={!password || busy} />
      <Button title={t('common.cancel')} variant="secondary" onPress={leave} disabled={busy} />
    </KeyboardForm>
  );
}
