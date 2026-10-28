import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { Button, EmptyState, ErrorText, Field, styles } from '@/components/ui';
import { newId } from '@/lib/id';
import { canCreateCourse } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

export default function NewCourseScreen() {
  const { addCourse, currentUser } = useStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // One id per form: a retry after a network error cannot create a second course.
  const [id] = useState(newId);
  const { busy, error, run } = useAction();

  if (currentUser && !canCreateCourse(currentUser.role)) {
    return <EmptyState title="Not allowed" hint="Only teachers and mentors can create courses." />;
  }

  function submit() {
    run(async () => {
      await addCourse({ id, title, description });
      if (router.canGoBack()) router.back();
      else router.replace('/courses');
    });
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { gap: 16 }]} keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic">
        <Field label="Title" placeholder="e.g. Algebra — Grade 7" value={title} onChangeText={setTitle} />
        <Field
          label="Description (optional)"
          placeholder="What is this course about?"
          value={description}
          onChangeText={setDescription}
          multiline
        />
        <ErrorText error={error} />
        <Button title={busy ? 'Creating…' : 'Create course'} onPress={submit} disabled={!title.trim() || busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
