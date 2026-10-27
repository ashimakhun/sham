import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { Button, ErrorText, Field, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

export default function NewMaterialScreen() {
  const { addMaterial } = useStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const { busy, error, run } = useAction();

  function submit() {
    run(async () => {
      await addMaterial({ title, body, link });
      if (router.canGoBack()) router.back();
      else router.replace('/materials');
    });
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { gap: 16 }]} keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic">
        <Field label="Title" placeholder="e.g. Lesson 3: Decimals" value={title} onChangeText={setTitle} />
        <Field
          label="Content"
          placeholder="Explanation, instructions, what to read…"
          value={body}
          onChangeText={setBody}
          multiline
        />
        <Field
          label="Link (optional)"
          placeholder="https://…"
          value={link}
          onChangeText={setLink}
          autoCapitalize="none"
          keyboardType="url"
        />
        <ErrorText error={error} />
        <Button
          title={busy ? 'Sharing…' : 'Share with class'}
          onPress={submit}
          disabled={!title.trim() || !body.trim() || busy}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
