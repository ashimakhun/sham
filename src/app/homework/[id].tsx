import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { dueText } from '@/components/AssignmentCard';
import { KeyboardForm } from '@/components/KeyboardForm';
import { PhotoPreview } from '@/components/PhotoPreview';

import { Button, Card, EmptyState, ErrorText, Field, StatusBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { canCheckHomework } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';
import { colors, formatDate, formatDateTime } from '@/lib/theme';

export default function HomeworkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { visibleHomework, currentUser, getUser, getCourse, checkHomework, assignments, meetings } = useStore();
  const [comment, setComment] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  // The photo's file is gone (or its link couldn't be made): show "Photo unavailable" instead of an empty box.
  const [photoFailed, setPhotoFailed] = useState(false);
  const { busy, error, run } = useAction();
  const { t, lang } = useI18n();

  const item = visibleHomework.find((h) => h.id === id);
  if (!item) return <EmptyState title={t('homework.notFound')} />;

  const student = getUser(item.studentId);
  const checker = getUser(item.checkedById);
  const canCheck = canCheckHomework(currentUser, item);
  // The assignment it was sent for (ARU-32); none for homework sent before assignments existed.
  const assignment = assignments.find((a) => a.id === item.assignmentId);
  const meeting = meetings.find((m) => m.id === assignment?.meetingId);

  return (
    <View style={styles.screen}>
      <KeyboardForm contentContainerStyle={styles.content}>
        <Card>
          <StatusBadge status={item.status} />
          <Text style={styles.h1}>{item.title}</Text>
          <Text style={[styles.label, { color: colors.primary }]}>{getCourse(item.courseId)?.title ?? t('homework.noCourse')}</Text>
          {assignment ? (
            <Text style={styles.muted} testID="homework-assignment">
              {t('homework.assignmentLine', { title: assignment.title })}
              {meeting ? ` · ${t('homework.meetingAt', { date: formatDateTime(meeting.startsAt) })}` : ''}
              {assignment.dueAt ? `\n${dueText(assignment, lang)}` : ''}
            </Text>
          ) : null}
          <Text style={styles.muted}>
            {student?.name} · {formatDate(item.createdAt)}
          </Text>
          {item.description ? <Text style={styles.body}>{item.description}</Text> : null}
          {item.photoPath && (
            // The whole photo, letterboxed (ARU-18 AC 1); tap for the full-screen preview.
            <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('homework.openPhoto')} onPress={() => setPreviewOpen(true)}>
              {item.photoUrl && !photoFailed ? (
                <Image
                  testID="homework-photo"
                  source={{ uri: item.photoUrl }}
                  resizeMode="contain"
                  style={{ width: '100%', height: 260, borderRadius: 10, backgroundColor: colors.border }}
                  onError={() => setPhotoFailed(true)}
                />
              ) : (
                <View
                  testID="homework-photo-unavailable"
                  style={{
                    width: '100%',
                    height: 120,
                    borderRadius: 10,
                    backgroundColor: colors.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Text style={styles.muted}>{t('photo.unavailable')}</Text>
                </View>
              )}
            </Pressable>
          )}
        </Card>

        {item.status === 'checked' && (
          <Card>
            <Text style={styles.label}>{t('homework.mentorFeedback')}</Text>
            <Text style={styles.body}>{item.mentorComment ?? t('homework.checkedNoComment')}</Text>
            <Text style={styles.muted}>
              {/* ARU-75: a checker who deleted their account shows as "Deleted account". */}
              {item.checkedById ? checker?.name : t('common.deletedAccount')}
              {item.checkedAt ? ` · ${formatDate(item.checkedAt)}` : ''}
            </Text>
          </Card>
        )}

        {canCheck && (
          <Card style={{ gap: 12 }}>
            <Field
              label={t('homework.commentLabel')}
              placeholder={t('homework.commentPlaceholder')}
              value={comment}
              onChangeText={setComment}
              multiline
            />
            <ErrorText error={error} />
            <Button
              title={busy ? t('common.saving') : t('homework.markChecked')}
              disabled={busy}
              onPress={() => run(() => checkHomework(item.id, comment))}
            />
          </Card>
        )}
      </KeyboardForm>
      {previewOpen && item.photoPath && (
        <PhotoPreview
          path={item.photoPath}
          homeworkId={item.id}
          title={item.title}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </View>
  );
}
