import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Card, ErrorText, Field, RoleBadge, styles } from '@/components/ui';
import { NAME_MAX, NAME_TOO_LONG } from '@/lib/profileName';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

/** ARU-71: the pencil next to the name (the same `create-outline` as ARU-70's discipline edit icon). */
export const EDIT_NAME_ICON = 'create-outline' as const;

/** The Profile tab's name card (name, email, role) with an "Edit name" pencil for the signed-in user (ARU-55, ARU-71). Only approved
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
      {/* The stored name stays on the card while editing, so a failed save still shows it (AC 9). ARU-71: the pencil
          sits right after the name; the name shrinks and wraps so the pencil is never pushed off the card. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
        <Text style={[styles.h1, { flexShrink: 1 }]}>{currentUser.name}</Text>
        {editing ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit name"
            onPress={startEditing}
            // 44×44 touch area; the negative margin keeps the 22 pt glyph on the name's first line.
            style={({ pressed }) => [
              { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -8 },
              pressed && { opacity: 0.6 },
            ]}>
            <Ionicons name={EDIT_NAME_ICON} size={22} color={colors.primary} />
          </Pressable>
        )}
      </View>
      {editing && (
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
      )}
      <Text style={styles.muted}>{session?.user.email}</Text>
      <RoleBadge role={currentUser.role} />
    </Card>
  );
}
