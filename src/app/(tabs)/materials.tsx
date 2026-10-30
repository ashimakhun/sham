import { router } from 'expo-router';
import { FlatList, Text } from 'react-native';

import { Button, Card, EmptyState, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

export default function MaterialsScreen() {
  const { currentUser, loading, refresh, materials, getUser } = useStore();
  // Teachers and mentors share materials (ARU-26); students only read.
  const canShare = currentUser?.role === 'teacher' || currentUser?.role === 'mentor';
  const sorted = [...materials].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={sorted}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={
        canShare ? <Button title="+ Share material" onPress={() => router.push('/materials/new')} /> : undefined
      }
      renderItem={({ item }) => (
        <Card onPress={() => router.push({ pathname: '/materials/[id]', params: { id: item.id } })}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.body} numberOfLines={2}>
            {item.body}
          </Text>
          <Text style={styles.muted}>
            {getUser(item.teacherId)?.name} · {formatDate(item.createdAt)}
            {item.link ? ' · 🔗 link' : ''}
          </Text>
        </Card>
      )}
      ListEmptyComponent={
        <EmptyState
          title="No materials yet"
          hint={
            canShare
              ? 'Share a lesson, notes or a link with your class.'
              : 'Your teacher and mentors have not shared anything yet.'
          }
        />
      }
    />
  );
}
