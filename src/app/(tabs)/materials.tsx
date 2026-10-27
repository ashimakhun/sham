import { router } from 'expo-router';
import { FlatList, Text } from 'react-native';

import { Button, Card, EmptyState, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

export default function MaterialsScreen() {
  const { currentUser, materials, getUser } = useStore();
  const isTeacher = currentUser?.role === 'teacher';
  const sorted = [...materials].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={sorted}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={
        isTeacher ? <Button title="+ Share material" onPress={() => router.push('/materials/new')} /> : undefined
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
          hint={isTeacher ? 'Share a lesson, notes or a link with your class.' : 'Your teacher has not shared anything yet.'}
        />
      }
    />
  );
}
