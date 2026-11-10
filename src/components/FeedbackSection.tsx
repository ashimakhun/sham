import { router } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/AppText';

import { RatingSummary } from '@/components/RatingSummary';
import { Button, Card, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { confirmDestructive } from '@/lib/confirm';
import { courseStarted, feedbackFor, isEdited, stars, starsLabel } from '@/lib/feedback';
import { isCourseListener } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/**
 * Course feedback (ARU-53): the average, the list (newest first) and, for a current listener of a started course,
 * Add / Edit / Delete of their own feedback. Shown on the full course screen and on the "not in this course" summary.
 * Reads the store's courseFeedback, which RLS limits to courses the user can see and which reloads live.
 */
export function FeedbackSection({ course }: { course: Course }) {
  const { courseFeedback, meetings, currentUser, courseMembers, getUser, deleteFeedback } = useStore();
  const { busy, error, run } = useAction();
  const { t, lang } = useI18n();

  const items = feedbackFor(courseFeedback, course.id);
  // Only current listeners write (owners and the teacher are never listeners; a removed listener's feedback stays
  // but is locked, AC 9).
  const listener = isCourseListener(currentUser, course, courseMembers);
  const started = courseStarted(meetings, course.id);
  const mine = listener ? items.find((f) => f.userId === currentUser?.id) : undefined;
  const openForm = () => router.push({ pathname: '/courses/[id]/feedback', params: { id: course.id } });

  return (
    <Card style={{ gap: 8 }}>
      <Text style={styles.label}>{t('feedback.heading')}</Text>
      <RatingSummary items={items} style={styles.title} />
      {listener && !started ? (
        <Text style={styles.muted}>{t('feedback.opensAfterFirst')}</Text>
      ) : null}
      {listener && started && !mine ? <Button title={t('feedback.add')} onPress={openForm} /> : null}
      {mine ? (
        <View style={{ gap: 8 }}>
          <Button title={t('feedback.edit')} variant="secondary" onPress={openForm} disabled={busy} />
          <Button
            title={busy ? t('feedback.deleting') : t('feedback.delete')}
            variant="danger"
            disabled={busy}
            onPress={() =>
              confirmDestructive(t('feedback.deleteTitle'), t('feedback.deleteMessage'), t('feedback.deleteConfirm')).then(
                (ok) => {
                  if (ok) run(() => deleteFeedback(mine.id));
                },
              )
            }
          />
          <ErrorText error={error} />
        </View>
      ) : null}
      {items.length === 0 && !(listener && !started) ? <Text style={styles.muted}>{t('feedback.none')}</Text> : null}
      {items.map((f, i) => (
        <View
          key={f.id}
          testID={`feedback-${f.id}`}
          style={[{ gap: 2, paddingTop: 8 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
          <Text style={styles.body}>{getUser(f.userId)?.name ?? t('common.unknown')}</Text>
          <Text style={{ color: colors.star, fontSize: 16 }} accessibilityLabel={starsLabel(f.rating, lang)}>
            {stars(f.rating)}
          </Text>
          <Text style={styles.body}>{f.body}</Text>
          <Text style={styles.muted}>
            {isEdited(f) ? t('feedback.edited', { date: formatDate(f.updatedAt) }) : formatDate(f.createdAt)}
          </Text>
        </View>
      ))}
    </Card>
  );
}
