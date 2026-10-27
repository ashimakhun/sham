import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { Button, Field, styles } from '@/components/ui';
import { useStore } from '@/lib/store';

export default function NewMaterialScreen() {
  const { addMaterial } = useStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');

  function submit() {
    addMaterial({ title, body, link });
    if (router.canGoBack()) router.back();
    else router.replace('/materials');
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { gap: 16 }]} keyboardShouldPersistTaps="handled">
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
        <Button title="Share with class" onPress={submit} disabled={!title.trim() || !body.trim()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
