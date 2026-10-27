import { router, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, Text } from 'react-native';

import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';
import { formatDate } from '@/lib/theme';

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { materials, currentUser, getUser, deleteMaterial } = useStore();
  const { busy, error, run } = useAction();

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
      <ErrorText error={error} />
      {currentUser?.id === item.teacherId && (
        <Button
          title={busy ? 'Deleting…' : 'Delete material'}
          variant="danger"
          disabled={busy}
          onPress={() =>
            run(async () => {
              await deleteMaterial(item.id);
              if (router.canGoBack()) router.back();
              else router.replace('/materials');
            })
          }
        />
      )}
    </ScrollView>
  );
}
