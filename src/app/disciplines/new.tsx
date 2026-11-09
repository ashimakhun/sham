import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/AppText';

import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, EmptyState, ErrorText, Field, styles, ThemedSwitch } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { canManageDisciplines } from '@/lib/disciplines';
import { newId } from '@/lib/id';
import { DISCIPLINE_NAME_MAX, useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

/** ARU-63 AC 1 / AC 2: the teacher creates a discipline, optionally hidden. */
export default function NewDisciplineScreen() {
  const { addDiscipline, currentUser } = useStore();
  const [name, setName] = useState('');
  const [hidden, setHidden] = useState(false);
  // One id per form; a retry of a create that went through gets the duplicate-name message, never a second one.
  const [id] = useState(newId);
  const { busy, error, run } = useAction();
  const { t } = useI18n();

  if (currentUser && !canManageDisciplines(currentUser)) {
    return <EmptyState title={t('disciplines.notAllowedTitle')} hint={t('disciplines.notAllowedHint')} />;
  }

  function submit() {
    run(async () => {
      await addDiscipline({ id, name, hidden });
      if (router.canGoBack()) router.back();
      else router.replace('/courses');
    });
  }

  return (
    <KeyboardForm>
      <Field
        label={t('disciplines.nameLabel')}
        placeholder={t('disciplines.namePlaceholder')}
        value={name}
        onChangeText={setName}
        maxLength={DISCIPLINE_NAME_MAX + 20}
      />
      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.body}>{t('disciplines.hidden')}</Text>
          <Text style={styles.muted}>{t('disciplines.hiddenHint')}</Text>
        </View>
        <ThemedSwitch
          accessibilityLabel={t('disciplines.hidden')}
          accessibilityHint={t('disciplines.hiddenHint')}
          value={hidden}
          onValueChange={setHidden}
          disabled={busy}
        />
      </View>
      <ErrorText error={error} />
      <Button title={busy ? t('disciplines.creating') : t('disciplines.create')} onPress={submit} disabled={!name.trim() || busy} />
    </KeyboardForm>
  );
}
