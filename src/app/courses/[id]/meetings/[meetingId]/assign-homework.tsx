import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { DateTimeField } from '@/components/DateTimeField';
import { nextFullHour } from '@/components/MeetingForm';
import { Button, EmptyState, ErrorText, Field, styles } from '@/components/ui';
import { newId } from '@/lib/id';
import { canManageMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import { useAction } from '@/lib/useAction';
import { useNow } from '@/lib/useNow';

const TITLE_MAX = 200;

/** Assign homework to a completed meeting (ARU-32): the course's current owner or the teacher, once per meeting. */
export default function AssignHomeworkScreen() {
  const { id: courseId, meetingId } = useLocalSearchParams<{ id: string; meetingId: string }>();
  const { currentUser, getCourse, meetings, assignments, addAssignment } = useStore();
  // One id per form: a retry after a network error cannot assign twice.
  const [id] = useState(newId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState<Date>();
  const { busy, error, run } = useAction();
  const saving = useRef(false);
  const now = useNow(15_000);

  const course = getCourse(courseId);
  const meeting = meetings.find((m) => m.id === meetingId && m.courseId === courseId);
  // An assignment this form saved itself doesn't count: the screen is closing.
  const existing = assignments.find((a) => a.meetingId === meetingId && a.id !== id);

  if (!course || !meeting) return <EmptyState title="Meeting not found" />;
  if (currentUser && !canManageMeetings(currentUser, course)) {
    return <EmptyState title="Not allowed" hint="Only the course owner or the teacher can assign homework." />;
  }
  if (meeting.status !== 'completed') {
    return <EmptyState title="Can't assign homework" hint="Homework can be assigned only to completed meetings." />;
  }
  if (existing) return <EmptyState title="Already assigned" hint="This meeting already has homework." />;

  const dueOk = !dueAt || dueAt.getTime() > now;
  const titleOk = title.trim().length > 0 && title.trim().length <= TITLE_MAX;

  function save() {
    if (saving.current) return;
    saving.current = true;
    run(async () => {
      try {
        await addAssignment({
          id,
          meetingId: meeting!.id,
          courseId: course!.id,
          title,
          description,
          dueAt: dueAt?.toISOString(),
        });
        if (router.canGoBack()) router.back();
        else router.replace({ pathname: '/courses/[id]', params: { id: course!.id } });
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { gap: 16 }]}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic">
        <Text style={styles.muted} numberOfLines={2}>
          {course.title} · {meeting.topic} · {formatDateTime(meeting.startsAt)}
        </Text>
        <Field
          label="Title"
          placeholder="e.g. Exercises 1–10"
          value={title}
          onChangeText={setTitle}
          maxLength={TITLE_MAX}
        />
        <Field
          label="Description (optional)"
          placeholder="What should listeners do?"
          value={description}
          onChangeText={setDescription}
          multiline
        />
        {dueAt ? (
          <>
            <DateTimeField label="Deadline" value={dueAt} onChange={setDueAt} />
            {!dueOk && <Text style={{ color: colors.warning, fontSize: 14 }}>The deadline must be in the future.</Text>}
            <Button title="Remove deadline" variant="secondary" onPress={() => setDueAt(undefined)} />
          </>
        ) : (
          <Button
            title="Add deadline"
            variant="secondary" // Default: tomorrow, on the next full hour.
            onPress={() => setDueAt(new Date(nextFullHour(new Date(now)).getTime() + 24 * 60 * 60 * 1000))}
          />
        )}
        <ErrorText error={error} />
        <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={!titleOk || !dueOk || busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
