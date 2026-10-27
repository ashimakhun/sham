import { router, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, Text } from 'react-native';

import { Button, Card, EmptyState, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { materials, currentUser, getUser, deleteMaterial } = useStore();

  const item = materials.find((m) => m.id === id);
  if (!item) return <EmptyState title="Material not found" />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.h1}>{item.title}</Text>
        <Text style={styles.muted}>
          {getUser(item.teacherId)?.name} · {formatDate(item.createdAt)}
        </Text>
        <Text style={styles.body}>{item.body}</Text>
      </Card>
      {item.link && <Button title="Open link" variant="secondary" onPress={() => Linking.openURL(item.link!)} />}
      {currentUser?.role === 'teacher' && (
        <Button
          title="Delete material"
          variant="danger"
          onPress={() => {
            deleteMaterial(item.id);
            if (router.canGoBack()) router.back();
            else router.replace('/materials');
          }}
        />
      )}
    </ScrollView>
  );
}
