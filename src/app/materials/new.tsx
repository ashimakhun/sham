import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { MarkdownEditor } from '@/components/MarkdownEditor';
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
        {/* Formatted blog post (ARU-38): stored as Markdown in materials.body, 10,000 characters at most. */}
        <View style={{ gap: 6 }}>
          <Text style={styles.label}>
            Content
          </Text>
          <MarkdownEditor
            value={body}
            onChange={setBody}
            placeholder="Explanation, instructions, what to read…"
            accessibilityLabel="Content"
            limitMessage="Content can be at most 10,000 characters."
          />
        </View>
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
