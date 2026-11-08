import { router, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { KeyboardForm } from '@/components/KeyboardForm';
import { NewPasswordFields } from '@/components/NewPasswordFields';
import { Button, ErrorText, Field } from '@/components/ui';
import { notify } from '@/lib/confirm';
import { useI18n } from '@/i18n/LanguageProvider';
import { newPasswordReady } from '@/lib/password';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/profile');
}

/** ARU-76: the signed-in user changes their own password (current password + new password, confirmed). */
export default function ChangePasswordScreen() {
  const { currentUser, changePassword } = useStore();
  const { busy, error, run } = useAction();
  const { t, tm } = useI18n();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // One change per tap, even before the disabled state has rendered.
  const saving = useRef(false);
  // Set after a successful change: turns the back block off first, then leaves on the next render.
  const [done, setDone] = useState(false);

  // AC 10: header back / close, the iOS swipe-down and Android back do nothing while the request runs.
  usePreventRemove(busy && !done, () => {});

  useEffect(() => {
    if (!done) return;
    notify(t('password.changed'));
    leave();
  }, [done, t]);

  if (!currentUser) return null;

  const canSave = current.length > 0 && newPasswordReady(password, confirm);

  function save() {
    if (!canSave || saving.current) return;
    saving.current = true;
    run(async () => {
      try {
        await changePassword(current, password);
        setDone(true);
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <KeyboardForm>
      <Field
        testID="current-password"
        label={t('password.current')}
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
      />
      <NewPasswordFields password={password} onPassword={setPassword} confirm={confirm} onConfirm={setConfirm} />
      <ErrorText error={tm(error)} />
      <Button title={busy ? t('common.saving') : t('common.save')} onPress={save} disabled={!canSave || busy || done} />
      {/* Back to Profile without saving (also the swipe-down / Android back); not while saving (AC 10). */}
      <Button title={t('common.cancel')} variant="secondary" onPress={leave} disabled={busy || done} />
    </KeyboardForm>
  );
}
