import { router } from 'expo-router';
import { FlatList } from 'react-native';

import { CourseCard } from '@/components/CourseCard';
import { Button, EmptyState, styles } from '@/components/ui';
import { canCreateCourse } from '@/lib/roles';
import { useStore } from '@/lib/store';

export default function CoursesScreen() {
  const { currentUser, loading, refresh, courses } = useStore();
  const canCreate = canCreateCourse(currentUser?.role);

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={courses}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={
        canCreate ? <Button title="+ New course" onPress={() => router.push('/courses/new')} /> : undefined
      }
      renderItem={({ item }) => <CourseCard course={item} />}
      ListEmptyComponent={
        <EmptyState
          title="No courses yet"
          hint={canCreate ? 'Tap "+ New course" to create the first one.' : 'Your teacher or mentor has not created any courses yet.'}
        />
      }
    />
  );
}
