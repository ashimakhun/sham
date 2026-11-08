import { useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { CourseMaterialsSection } from '@/components/CourseMaterialsSection';
import { DeleteCourseButton } from '@/components/DeleteCourseButton';
import { canChangeCourseDiscipline, DisciplineLabel, EditCoursePencil } from '@/components/Disciplines';
import { FeedbackSection } from '@/components/FeedbackSection';
import { ListenersSection } from '@/components/ListenersSection';
import { MeetingsSection } from '@/components/MeetingsSection';
import { PaySection } from '@/components/PaySection';
import { Card, EmptyState, HiddenBadge, OwnerLine, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { canChangeOwner, seesOnlyCourseSummary } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCourse, getUser, loading, refresh, currentUser, courseMembers } = useStore();
  const { t } = useI18n();

  const course = getCourse(id);
  if (!course) return <EmptyState title={t('courses.notFound')} />;

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
          <Text style={styles.h1}>{course.title}</Text>
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
              </View>
              {canEdit ? <EditCoursePencil courseId={course.id} /> : null}
            </View>
            <OwnerLine name={getUser(course.createdById)?.name ?? t('common.unknown')} date={formatDate(course.createdAt)} />
            {/* ARU-63 AC 6: only a discipline the viewer can see. */}
            <DisciplineLabel course={course} />
            {course.description ? <Text style={styles.body}>{course.description}</Text> : null}
          </Card>
          {/* ARU-99 AC 1: Pay (or "request sent") for an unpaid listener of a paid course in its payment period. */}
          <PaySection course={course} />
          {/* ARU-103 AC 8: the discipline and the owner are changed from Edit course (the pencil above). */}
          <MeetingsSection course={course} />
          <ListenersSection course={course} />
          <CourseMaterialsSection course={course} />
          <FeedbackSection course={course} />
        </View>
      {/* ARU-60: checked and canceled meetings, at the very bottom. ARU-85: the teacher's "Delete course" below them. */}
      <MeetingsSection course={course} part="history" />
      <DeleteCourseButton course={course} />
    </ScrollView>
  );
}
