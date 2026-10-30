import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from 'react-native';

import { dueText } from '@/components/AssignmentCard';
import { PhotoPreview } from '@/components/PhotoPreview';

import { Button, Card, EmptyState, ErrorText, Field, StatusBadge, styles } from '@/components/ui';
import { canCheckHomework } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';
import { colors, formatDate, formatDateTime } from '@/lib/theme';

export default function HomeworkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { visibleHomework, currentUser, getUser, getCourse, checkHomework, assignments, meetings } = useStore();
  const [comment, setComment] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const { busy, error, run } = useAction();

  const item = visibleHomework.find((h) => h.id === id);
  if (!item) return <EmptyState title="Homework not found" />;

  const student = getUser(item.studentId);
  const checker = getUser(item.checkedById);
  const canCheck = canCheckHomework(currentUser, item);
  // The assignment it was sent for (ARU-32); none for homework sent before assignments existed.
  const assignment = assignments.find((a) => a.id === item.assignmentId);
  const meeting = meetings.find((m) => m.id === assignment?.meetingId);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic">
        <Card>
          <StatusBadge status={item.status} />
          <Text style={styles.h1}>{item.title}</Text>
          <Text style={[styles.label, { color: colors.primary }]}>{getCourse(item.courseId)?.title ?? 'No course'}</Text>
          {assignment ? (
            <Text style={styles.muted} testID="homework-assignment">
              Assignment: {assignment.title}
              {meeting ? ` · Meeting ${formatDateTime(meeting.startsAt)}` : ''}
              {assignment.dueAt ? `\n${dueText(assignment)}` : ''}
            </Text>
          ) : null}
          <Text style={styles.muted}>
            {student?.name} · {formatDate(item.createdAt)}
          </Text>
          {item.description ? <Text style={styles.body}>{item.description}</Text> : null}
          {item.photoPath && (
            // The whole photo, letterboxed (ARU-18 AC 1); tap for the full-screen preview.
            <Pressable accessibilityRole="imagebutton" accessibilityLabel="Open photo" onPress={() => setPreviewOpen(true)}>
              <Image
                testID="homework-photo"
                source={{ uri: item.photoUrl }}
                resizeMode="contain"
                style={{ width: '100%', height: 260, borderRadius: 10, backgroundColor: colors.border }}
              />
            </Pressable>
          )}
        </Card>

        {item.status === 'checked' && (
          <Card>
            <Text style={styles.label}>MENTOR FEEDBACK</Text>
            <Text style={styles.body}>{item.mentorComment ?? 'Checked without a comment.'}</Text>
            <Text style={styles.muted}>
              {checker?.name}
              {item.checkedAt ? ` · ${formatDate(item.checkedAt)}` : ''}
            </Text>
          </Card>
        )}

        {canCheck && (
          <Card style={{ gap: 12 }}>
            <Field
              label="Comment for the student (optional)"
              placeholder="What was good? What to improve?"
              value={comment}
              onChangeText={setComment}
              multiline
            />
            <ErrorText error={error} />
            <Button
              title={busy ? 'Saving…' : '✓ Mark as checked'}
              disabled={busy}
              onPress={() => run(() => checkHomework(item.id, comment))}
            />
          </Card>
        )}
      </ScrollView>
      {previewOpen && item.photoPath && (
        <PhotoPreview
          path={item.photoPath}
          homeworkId={item.id}
          title={item.title}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}
