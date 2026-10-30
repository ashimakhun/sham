import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';

import { HomeworkCard } from '@/components/HomeworkCard';
import { ListenersSection } from '@/components/ListenersSection';
import { MeetingsSection } from '@/components/MeetingsSection';
import { Button, Card, EmptyState, OwnerLine, styles } from '@/components/ui';
import { canChangeOwner, inCourseChat, seesOnlyCourseSummary } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCourse, getUser, visibleHomework, loading, refresh, currentUser, courseMembers, unreadCount } = useStore();

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
          {course.description ? <Text style={styles.body}>{course.description}</Text> : null}
        </Card>
        <EmptyState title="You are not in this course" hint="Ask your teacher or mentor to add you." />
      </ScrollView>
    );
  }

  // visibleHomework is already limited by RLS: own homework for students, all for mentors and the teacher (ARU-14).
  const homework = visibleHomework.filter((h) => h.courseId === course.id);

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      data={homework}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(h) => h.id}
      renderItem={({ item }) => <HomeworkCard item={item} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Card>
            <Text style={styles.h1}>{course.title}</Text>
            <OwnerLine name={getUser(course.createdById)?.name ?? 'Unknown'} date={formatDate(course.createdAt)} />
            {course.description ? <Text style={styles.body}>{course.description}</Text> : null}
          </Card>
          {inCourseChat(currentUser, course, courseMembers) && (
            <Button
              title="Chat"
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
          <Text style={styles.label}>HOMEWORK</Text>
        </View>
      }
      ListEmptyComponent={<EmptyState title="No homework for this course yet" />}
    />
  );
}
