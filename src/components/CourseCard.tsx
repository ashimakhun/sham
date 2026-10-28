import { router } from 'expo-router';
import { Text } from 'react-native';

import { Card, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';

export function CourseCard({ course }: { course: Course }) {
  const { getUser } = useStore();

  return (
    <Card onPress={() => router.push({ pathname: '/courses/[id]', params: { id: course.id } })}>
      <Text style={styles.title} numberOfLines={2}>
        {course.title}
      </Text>
      {course.description ? (
        <Text style={styles.body} numberOfLines={2}>
          {course.description}
        </Text>
      ) : null}
      <Text style={styles.muted} numberOfLines={1}>
        {getUser(course.createdById)?.name ?? 'Unknown'} · {formatDate(course.createdAt)}
      </Text>
    </Card>
  );
}
