import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { DisciplinePicker } from '@/components/Disciplines';
import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, EmptyState, ErrorText, Field, styles } from '@/components/ui';
import { newId } from '@/lib/id';
import { canCreateCourse } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

export default function NewCourseScreen() {
  const { addCourse, currentUser, disciplines } = useStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // ARU-40: off by default; kept on an error so a retry creates the same course.
  const [hidden, setHidden] = useState(false);
  // ARU-63 AC 4: optional; "No discipline" by default.
  const [disciplineId, setDisciplineId] = useState<string>();
  // One id per form: a retry after a network error cannot create a second course.
  const [id] = useState(newId);
  const { busy, error, run } = useAction();

  if (currentUser && !canCreateCourse(currentUser.role)) {
    return <EmptyState title="Not allowed" hint="Only teachers and mentors can create courses." />;
  }

  function submit() {
    run(async () => {
      // Off and no discipline: exactly today's call (a visible course with no discipline).
      await addCourse({
        id,
        title,
        description,
        ...(hidden ? { hidden } : {}),
        ...(disciplineId ? { disciplineId } : {}),
      });
      if (router.canGoBack()) router.back();
      else router.replace('/courses');
    });
  }

  return (
    <KeyboardForm>
      <Field label="Title" placeholder="e.g. Algebra — Grade 7" value={title} onChangeText={setTitle} />
      <Field
        label="Description (optional)"
        placeholder="What is this course about?"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.body}>Hidden course</Text>
          <Text style={styles.muted}>Only the owner, listeners and the teacher will see this course.</Text>
        </View>
        <Switch
          accessibilityLabel="Hidden course"
          accessibilityHint="Only the owner, listeners and the teacher will see this course."
          value={hidden}
          onValueChange={setHidden}
          disabled={busy}
        />
      </View>
      {/* Only when there is something to pick; with no disciplines every course has none. */}
      {disciplines.length > 0 && <DisciplinePicker value={disciplineId} onChange={setDisciplineId} disabled={busy} />}
      <ErrorText error={error} />
      <Button title={busy ? 'Creating…' : 'Create course'} onPress={submit} disabled={!title.trim() || busy} />
    </KeyboardForm>
  );
}
