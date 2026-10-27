import { router } from 'expo-router';
import { Text } from 'react-native';

import { Card, StatusBadge, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';
import type { Homework } from '@/lib/types';

export function HomeworkCard({ item }: { item: Homework }) {
  const { currentUser, getUser } = useStore();
  const showStudent = currentUser?.role !== 'student';

  return (
    <Card onPress={() => router.push({ pathname: '/homework/[id]', params: { id: item.id } })}>
      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.muted}>
        {showStudent ? `${getUser(item.studentId)?.name ?? 'Unknown student'} · ` : ''}
        {formatDate(item.createdAt)}
        {item.photoUri ? ' · 📎 photo' : ''}
      </Text>
      <StatusBadge status={item.status} />
    </Card>
  );
}
