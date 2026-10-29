import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Card, OwnerLine, styles } from '@/components/ui';
import { seesOnlyCourseSummary } from '@/lib/roles';
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
  const { getUser, currentUser, courseMembers } = useStore();
  // A student who is not a listener sees only the title and description (ARU-24).
  const summaryOnly = seesOnlyCourseSummary(currentUser, course, courseMembers);

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
      {!summaryOnly && (
        <OwnerLine name={getUser(course.createdById)?.name ?? 'Unknown'} date={formatDate(course.createdAt)} />
      )}
    </Card>
  );
}
