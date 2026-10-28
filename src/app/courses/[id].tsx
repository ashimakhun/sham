import { useLocalSearchParams } from 'expo-router';
import { FlatList, Text } from 'react-native';

import { HomeworkCard } from '@/components/HomeworkCard';
import { Card, EmptyState, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCourse, getUser, visibleHomework, loading, refresh } = useStore();

  const course = getCourse(id);
  if (!course) return <EmptyState title="Course not found" />;

  // visibleHomework is already limited by RLS: own (student), own students' (mentor), all (teacher).
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
        <Card>
          <Text style={styles.h1}>{course.title}</Text>
          <Text style={styles.muted}>
            {getUser(course.createdById)?.name ?? 'Unknown'} · {formatDate(course.createdAt)}
          </Text>
          {course.description ? <Text style={styles.body}>{course.description}</Text> : null}
        </Card>
      }
      ListEmptyComponent={<EmptyState title="No homework for this course yet" />}
    />
  );
}
