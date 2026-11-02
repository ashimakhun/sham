import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Card, ErrorText, Field, RoleBadge, styles } from '@/components/ui';
import { NAME_MAX, NAME_TOO_LONG } from '@/lib/profileName';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

/** The Profile tab's name card (name, email, role) with "Edit name" for the signed-in user (ARU-55). Only approved
 *  users reach the Profile tab: pending and rejected accounts see only the waiting screen (ARU-43). */
export function ProfileNameCard() {
  const { currentUser, session, updateMyName } = useStore();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  // Blocks a second tap before the busy state has rendered, so a double tap sends one request.
  const saving = useRef(false);
  if (!currentUser) return null;

  const trimmed = text.trim();
  const tooLong = trimmed.length > NAME_MAX;
  // Blank, too long or unchanged: nothing to save (AC 5–7).
  const canSave = !busy && trimmed.length > 0 && !tooLong && trimmed !== currentUser.name;

  const startEditing = () => {
    setText(currentUser.name);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setText('');
  };
  const save = () => {
    if (!canSave || saving.current) return;
    saving.current = true;
    run(async () => {
      try {
        await updateMyName(trimmed);
        setEditing(false);
      } finally {
        saving.current = false;
      }
    });
  };

  return (
    <Card>
      {/* The stored name stays on the card while editing, so a failed save still shows it (AC 9). */}
      <Text style={styles.h1}>{currentUser.name}</Text>
      {editing ? (
        <View style={{ gap: 10 }}>
          <Field
            label="NAME"
            value={text}
            onChangeText={setText}
            autoFocus
            autoComplete="name"
            autoCapitalize="words"
            textContentType="name"
            returnKeyType="done"
            onSubmitEditing={save}
            editable={!busy}
          />
          {tooLong && <Text style={{ color: colors.danger, fontSize: 14 }}>{NAME_TOO_LONG}</Text>}
          <ErrorText error={error} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={!canSave} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="secondary" onPress={cancel} disabled={busy} />
            </View>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit name"
          hitSlop={8}
          onPress={startEditing}
          style={{ alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Edit name</Text>
        </Pressable>
      )}
      <Text style={styles.muted}>{session?.user.email}</Text>
      <RoleBadge role={currentUser.role} />
    </Card>
  );
}
