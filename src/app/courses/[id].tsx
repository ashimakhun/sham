import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';

import { CourseMaterialsSection } from '@/components/CourseMaterialsSection';
import { CompleteCourseButton } from '@/components/CompleteCourseButton';
import { DeleteCourseButton } from '@/components/DeleteCourseButton';
import { canChangeCourseDiscipline, DisciplineLabel, EditCoursePencil } from '@/components/Disciplines';
import { FeedbackSection } from '@/components/FeedbackSection';
import { ListenersSection } from '@/components/ListenersSection';
import { MeetingsSection } from '@/components/MeetingsSection';
import { Card, CompletedBadge, EmptyState, HiddenBadge, OwnerLine, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { isCourseCompleted } from '@/lib/courseCompletion';
import { canChangeOwner, seesOnlyCourseSummary } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCourse, getUser, loading, refresh, currentUser, courseMembers, refreshMeetingNotes } = useStore();
  const { t } = useI18n();
  // ARU-143 AC 10: notes someone made private disappear the next time the course opens (realtime doesn't tell a
  // client that lost access to a row).
  useFocusEffect(
    useCallback(() => {
      refreshMeetingNotes().catch(() => {});
    }, [refreshMeetingNotes]),
  );

  const course = getCourse(id);
  if (!course) return <EmptyState title={t('courses.notFound')} />;
  // ARU-197 AC 4: the Completed badge next to the title and "Completed on <date>" under it, for everyone who sees
  // the course. The date is in the app's date format and language.
  const completed = isCourseCompleted(course);
  const completedLine =
    completed && course.completedAt ? (
      <Text testID="course-completed-on" style={styles.muted}>
        {t('courses.completedOn', { date: formatDate(course.completedAt) })}
      </Text>
    ) : null;

  // ARU-24: a student who is not a listener sees only the title and description. Derived at render time, so a
  // live update on course_members switches between this and the full screen on its own.
  if (seesOnlyCourseSummary(currentUser, course, courseMembers)) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />}>
        <Card>
          {completed ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={[styles.h1, { flexShrink: 1 }]}>{course.title}</Text>
              <CompletedBadge />
            </View>
          ) : (
            <Text style={styles.h1}>{course.title}</Text>
          )}
          {completedLine}
          <DisciplineLabel course={course} />
          {course.description ? <Text style={styles.body}>{course.description}</Text> : null}
        </Card>
        {/* ARU-53: everyone who sees the course reads its feedback. */}
        <FeedbackSection course={course} />
        <EmptyState title={t('courses.notInCourse')} hint={t('courses.askToBeAdded')} />
      </ScrollView>
    );
  }

  // ARU-103 AC 1 / AC 2: the pencil for the teacher and mentors (a course owner is always one of them).
  const canEdit = canChangeOwner(currentUser?.role) || canChangeCourseDiscipline(currentUser, course);

  // ARU-80: no homework list here any more (it lives on the Homework tab, with a course filter on Checked).
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />}>
        <View style={{ gap: 12 }}>
          <Card>
            {/* ARU-103 AC 1: the title (and Hidden badge) wrap on the left; the Edit course pencil stays on the right. */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={[styles.h1, { flexShrink: 1 }]}>{course.title}</Text>
                {course.hidden ? <HiddenBadge /> : null}
                {completed ? <CompletedBadge /> : null}
              </View>
              {canEdit ? <EditCoursePencil courseId={course.id} /> : null}
            </View>
            {completedLine}
            <OwnerLine name={getUser(course.createdById)?.name ?? t('common.unknown')} date={formatDate(course.createdAt)} />
            {/* ARU-63 AC 6: only a discipline the viewer can see. */}
            <DisciplineLabel course={course} />
            {course.description ? <Text style={styles.body}>{course.description}</Text> : null}
          </Card>
          {/* ARU-161: no Pay or "request sent" for listeners (ARU-99's listener side removed). */}
          {/* ARU-103 AC 8: the discipline and the owner are changed from Edit course (the pencil above). */}
          <MeetingsSection course={course} />
          <ListenersSection course={course} />
          <CourseMaterialsSection course={course} />
          <FeedbackSection course={course} />
        </View>
      {/* ARU-60: checked and canceled meetings, at the very bottom. ARU-85: the teacher's "Delete course" below them. */}
      <MeetingsSection course={course} part="history" />
      {/* ARU-197: Complete course / Reopen course for the owner and the teacher, above the teacher's Delete course. */}
      <CompleteCourseButton course={course} />
      <DeleteCourseButton course={course} />
    </ScrollView>
  );
}
