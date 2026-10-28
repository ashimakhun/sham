import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Card, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';

type Props = {
  course: Course;
  /** Optional relation tag ("Listener" / "Owner") shown above the title (ARU-12). */
  tag?: string;
  /** Called just before the details screen opens. */
  onOpen?: () => void;
};

export function CourseCard({ course, tag, onOpen }: Props) {
  const { getUser } = useStore();

  return (
    <Card
      onPress={() => {
        onOpen?.();
        router.push({ pathname: '/courses/[id]', params: { id: course.id } });
      }}>
      {tag ? (
        <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
          <Text style={[styles.badgeText, { color: colors.primary }]} numberOfLines={1}>
            {tag}
          </Text>
        </View>
      ) : null}
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
