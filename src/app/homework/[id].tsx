import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { dueText } from '@/components/AssignmentCard';
import { KeyboardForm } from '@/components/KeyboardForm';
import { PhotoPreview } from '@/components/PhotoPreview';

import { Button, Card, EmptyState, ErrorText, Field, StatusBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { homeworkPhotos } from '@/lib/photo';
import { canCheckHomework } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';
import { colors, formatDate, formatDateTime } from '@/lib/theme';
import type { HomeworkPhoto } from '@/lib/types';

export default function HomeworkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { visibleHomework, currentUser, getUser, getCourse, checkHomework, assignments, meetings, getPhotoUrl } =
    useStore();
  const [comment, setComment] = useState('');
  // ARU-191: the photo open in the full-screen preview (its path), if any.
  const [previewPath, setPreviewPath] = useState<string | null>(null);
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
  // ARU-184: the "Assignment: …" row is left out when it would just repeat the heading (trimmed, ignoring case).
  const showAssignmentTitle =
    !!assignment && assignment.title.trim().toLowerCase() !== item.title.trim().toLowerCase();
  // ARU-191 AC 6 / AC 8: every photo in order (a homework sent before ARU-191 has one).
  const photos = homeworkPhotos(item);

  return (
    <View style={styles.screen}>
      <KeyboardForm contentContainerStyle={styles.content}>
        <Card>
          <StatusBadge status={item.status} />
          <Text style={styles.h1}>{item.title}</Text>
          <Text style={[styles.label, { color: colors.primary }]}>{getCourse(item.courseId)?.title ?? t('homework.noCourse')}</Text>
          {assignment && (showAssignmentTitle || meeting || assignment.dueAt) ? (
            // ARU-117: one row each, so a long title wraps on its own and never splits the meeting date.
            <View testID="homework-assignment">
              {showAssignmentTitle ? (
                <Text style={styles.muted}>{t('homework.assignmentLine', { title: assignment.title })}</Text>
              ) : null}
              {meeting ? (
                <Text style={styles.muted} testID="homework-assignment-meeting">
                  {t('homework.meetingAt', { date: formatDateTime(meeting.startsAt) })}
                </Text>
              ) : null}
              {assignment.dueAt ? (
                <Text style={styles.muted} testID="homework-assignment-due">
                  {dueText(assignment, lang)}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.muted}>
            {student?.name} · {formatDate(item.createdAt)}
          </Text>
          {item.description ? <Text style={styles.body}>{item.description}</Text> : null}
          {!photos.length && item.photoRemovedAt ? (
            // ARU-112 AC 6 / ARU-191 AC 9: the daily job removed them; one note instead of the photos, with no preview
            // and no Download.
            <View
              testID="homework-photo-removed"
              style={{
                width: '100%',
                height: 120,
                borderRadius: 10,
                backgroundColor: colors.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text style={styles.muted}>
                {/* ARU-203: one photo (or an unknown count) keeps the old text; 2 or more say how many. */}
                {(item.photosRemovedCount ?? 0) > 1
                  ? t('homework.photosRemoved', { count: item.photosRemovedCount ?? 0 })
                  : t('homework.photoRemoved')}
              </Text>
            </View>
          ) : null}
          {photos.map((photo, i) => (
            <HomeworkPhotoTile
              key={`${i}:${photo.path}`}
              photo={photo}
              label={photos.length > 1 ? t('homework.openPhotoNumber', { n: i + 1 }) : t('homework.openPhoto')}
              getPhotoUrl={getPhotoUrl}
              onOpen={() => setPreviewPath(photo.path)}
            />
          ))}
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
      {previewPath && (
        <PhotoPreview
          path={previewPath}
          homeworkId={item.id}
          title={photos.length > 1 ? `${item.title} ${photos.findIndex((p) => p.path === previewPath) + 1}` : item.title}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </View>
  );
}

/**
 * One photo of a homework (ARU-18 AC 1: the whole photo, letterboxed; tap for the full-screen preview). ARU-191 AC 6: a
 * photo that fails shows "Photo unavailable" on its own. ARU-156: the loaded link may have expired (links last an
 * hour): on the first error, ask once for a fresh link, and show "Photo unavailable" only if that one fails too.
 */
function HomeworkPhotoTile({
  photo,
  label,
  getPhotoUrl,
  onOpen,
}: {
  photo: HomeworkPhoto;
  label: string;
  getPhotoUrl: (path: string) => Promise<string>;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const retried = useRef(false);
  const url = freshUrl ?? photo.url;

  function onError() {
    if (retried.current) {
      setFailed(true);
      return;
    }
    retried.current = true;
    getPhotoUrl(photo.path).then(setFreshUrl, () => setFailed(true));
  }

  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={label} onPress={onOpen}>
      {url && !failed ? (
        <Image
          testID="homework-photo"
          source={{ uri: url }}
          resizeMode="contain"
          style={{ width: '100%', height: 260, borderRadius: 10, backgroundColor: colors.border }}
          onError={onError}
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
  );
}
