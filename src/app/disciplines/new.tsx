import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Text } from '@/components/AppText';

import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, EmptyState, ErrorText, Field, styles } from '@/components/ui';
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

  if (currentUser && !canManageDisciplines(currentUser)) {
    return <EmptyState title="Not allowed" hint="Only the teacher can create disciplines." />;
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
        label="Name"
        placeholder="e.g. Mathematics"
        value={name}
        onChangeText={setName}
        maxLength={DISCIPLINE_NAME_MAX + 20}
      />
      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.body}>Hidden discipline</Text>
          <Text style={styles.muted}>Only the teacher will see this discipline.</Text>
        </View>
        <Switch
          accessibilityLabel="Hidden discipline"
          accessibilityHint="Only the teacher will see this discipline."
          value={hidden}
          onValueChange={setHidden}
          disabled={busy}
        />
      </View>
      <ErrorText error={error} />
      <Button title={busy ? 'Creating…' : 'Create discipline'} onPress={submit} disabled={!name.trim() || busy} />
    </KeyboardForm>
  );
}
