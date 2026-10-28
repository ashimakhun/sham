import { router } from 'expo-router';
import { Text } from 'react-native';

import { Card, StatusBadge, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Homework } from '@/lib/types';

export function HomeworkCard({ item }: { item: Homework }) {
  const { currentUser, getUser, getCourse } = useStore();
  const showStudent = currentUser?.role !== 'student';

  return (
    <Card onPress={() => router.push({ pathname: '/homework/[id]', params: { id: item.id } })}>
      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={[styles.label, { color: colors.primary }]} numberOfLines={2}>
        {getCourse(item.courseId)?.title ?? 'No course'}
      </Text>
      <Text style={styles.muted}>
        {showStudent ? `${getUser(item.studentId)?.name ?? 'Unknown student'} · ` : ''}
        {formatDate(item.createdAt)}
        {item.photoUrl ? ' · 📎 photo' : ''}
      </Text>
      <StatusBadge status={item.status} />
    </Card>
  );
}
