import { router, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { CourseMaterialsSection } from '@/components/CourseMaterialsSection';
import { CourseDisciplineSection, DisciplineLabel } from '@/components/Disciplines';
import { FeedbackSection } from '@/components/FeedbackSection';
import { ListenersSection } from '@/components/ListenersSection';
import { MeetingsSection } from '@/components/MeetingsSection';
import { Button, Card, EmptyState, HiddenBadge, OwnerLine, styles } from '@/components/ui';
import { canChangeOwner, inCourseChat, seesOnlyCourseSummary } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCourse, getUser, loading, refresh, currentUser, courseMembers, unreadCount } = useStore();

  const course = getCourse(id);
  if (!course) return <EmptyState title="Course not found" />;

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
        <EmptyState title="You are not in this course" hint="Ask your teacher or mentor to add you." />
      </ScrollView>
    );
  }

  // ARU-80: no homework list here any more (it lives on the Homework tab, with a course filter on Checked).
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />}>
        <View style={{ gap: 12 }}>
          <Card>
            {course.hidden ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={[styles.h1, { flexShrink: 1 }]}>{course.title}</Text>
                <HiddenBadge />
              </View>
            ) : (
              <Text style={styles.h1}>{course.title}</Text>
            )}
            <OwnerLine name={getUser(course.createdById)?.name ?? 'Unknown'} date={formatDate(course.createdAt)} />
            {/* ARU-63 AC 6: only a discipline the viewer can see. */}
            <DisciplineLabel course={course} />
            {course.description ? <Text style={styles.body}>{course.description}</Text> : null}
          </Card>
          {/* ARU-63 AC 5 / ARU-70: the teacher (any course) or the current owner changes the discipline here. */}
          <CourseDisciplineSection course={course} />
          {inCourseChat(currentUser, course, courseMembers) && (
            <Button
              // ARU-69: the chat icon; screen readers hear the same label as the course card's icon.
              title={`Open chat for ${course.title}`}
              icon="chatbubble-outline"
              variant="secondary"
              unread={unreadCount(course.id)}
              onPress={() => router.push({ pathname: '/courses/[id]/chat', params: { id: course.id } })}
            />
          )}
          {canChangeOwner(currentUser?.role) && (
            <Button
              title="Change owner"
              variant="secondary"
              onPress={() => router.push({ pathname: '/courses/[id]/owner', params: { id: course.id } })}
            />
          )}
          <MeetingsSection course={course} />
          <ListenersSection course={course} />
          <CourseMaterialsSection course={course} />
          <FeedbackSection course={course} />
        </View>
      {/* ARU-60: checked and canceled meetings, at the very bottom. */}
      <MeetingsSection course={course} part="history" />
    </ScrollView>
  );
}
