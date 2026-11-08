import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, Switch, Text, View } from 'react-native';

import { CourseCard } from '@/components/CourseCard';
import { DeleteDisciplineButton } from '@/components/DeleteDisciplineButton';
import { Card, EmptyState, ErrorText, HiddenBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { canManageDisciplines, coursesInDiscipline, disciplineFeedback } from '@/lib/disciplines';
import { isEdited, ratingSummary, ratingSummaryLabel, stars, starsLabel } from '@/lib/feedback';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

/**
 * ARU-63 AC 10 / AC 11: a discipline's rating and all the reviews of its courses the user can read (read-only); the
 * teacher also sees its courses and the hide switch. A discipline hidden from the user is "Discipline not found".
 */
export default function DisciplineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getDiscipline, courses, courseFeedback, getUser, getCourse, currentUser, loading, refresh, setDisciplineHidden } =
    useStore();
  const { busy, error, run } = useAction();
  const { t, lang } = useI18n();
  const discipline = getDiscipline(id);
  if (!discipline) return <EmptyState title={t('disciplines.notFound')} />;

  const teacher = canManageDisciplines(currentUser);
  const reviews = disciplineFeedback(discipline.id, courses, courseFeedback);
  const summary = ratingSummary(reviews, lang);
  const assigned = coursesInDiscipline(discipline.id, courses);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      // Pull to refresh, as on the Courses tab (picks up a discipline the teacher hid, AC 12).
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />}>
      <Stack.Screen options={{ title: discipline.name }} />
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={[styles.h1, { flexShrink: 1 }]}>{discipline.name}</Text>
          {discipline.hidden ? <HiddenBadge /> : null}
        </View>
        {summary ? (
          <Text style={styles.title} accessibilityLabel={ratingSummaryLabel(reviews, lang)}>
            {summary}
          </Text>
        ) : null}
        {teacher && (
          <View style={[styles.row, { alignItems: 'flex-start', paddingTop: 4 }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.body}>{t('disciplines.hidden')}</Text>
              <Text style={styles.muted}>{t('disciplines.hiddenHint')}</Text>
            </View>
            <Switch
              accessibilityLabel={t('disciplines.hidden')}
              value={discipline.hidden}
              disabled={busy}
              onValueChange={(value) => run(() => setDisciplineHidden(discipline.id, value))}
            />
          </View>
        )}
        <ErrorText error={error} />
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={styles.label}>{t('disciplines.reviews')}</Text>
        {reviews.length === 0 ? <Text style={styles.muted}>{t('disciplines.noReviews')}</Text> : null}
        {reviews.map((f, i) => (
          <View
            key={f.id}
            testID={`review-${f.id}`}
            style={[{ gap: 2, paddingTop: 8 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.primary }]} numberOfLines={2}>
              {getCourse(f.courseId)?.title ?? t('disciplines.courseFallback')}
            </Text>
            <Text style={styles.body}>{getUser(f.userId)?.name ?? t('common.unknown')}</Text>
            <Text style={{ color: '#F59E0B', fontSize: 16 }} accessibilityLabel={starsLabel(f.rating, lang)}>
              {stars(f.rating)}
            </Text>
            <Text style={styles.body}>{f.body}</Text>
            <Text style={styles.muted}>
              {isEdited(f) ? t('disciplines.edited', { date: formatDate(f.updatedAt) }) : formatDate(f.createdAt)}
            </Text>
          </View>
        ))}
      </Card>

      {teacher && (
        <View style={{ gap: 12 }} testID="discipline-courses">
          <Text style={styles.label}>{t('disciplines.courses')}</Text>
          {assigned.length === 0 ? (
            <Text style={styles.muted}>{t('disciplines.noCourses')}</Text>
          ) : (
            assigned.map((c) => <CourseCard key={c.id} course={c} />)
          )}
        </View>
      )}
      {/* ARU-83: below the COURSES list, the teacher only. */}
      <DeleteDisciplineButton discipline={discipline} />
    </ScrollView>
  );
}
