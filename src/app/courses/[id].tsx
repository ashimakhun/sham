import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, Text, View } from 'react-native';

import { HomeworkCard } from '@/components/HomeworkCard';
import { ListenersSection } from '@/components/ListenersSection';
import { Button, Card, EmptyState, OwnerLine, styles } from '@/components/ui';
import { canChangeOwner, inCourseChat } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCourse, getUser, visibleHomework, loading, refresh, currentUser, courseMembers } = useStore();

  const course = getCourse(id);
  if (!course) return <EmptyState title="Course not found" />;

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
          <ListenersSection course={course} />
          <Text style={styles.label}>HOMEWORK</Text>
        </View>
      }
      ListEmptyComponent={<EmptyState title="No homework for this course yet" />}
    />
  );
}
