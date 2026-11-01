import { router, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, Text } from 'react-native';

import { MarkdownText } from '@/components/MarkdownText';
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
  // Only the author, and only while they are still a teacher or mentor (a mentor made student can't delete).
  const canDelete =
    currentUser?.id === item.teacherId && (currentUser.role === 'teacher' || currentUser.role === 'mentor');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <Card>
        <Text style={styles.h1}>{item.title}</Text>
        <Text style={styles.muted}>
          {getUser(item.teacherId)?.name} · {formatDate(item.createdAt)}
        </Text>
        {/* Formatted (ARU-38); old plain-text posts keep their text and line breaks. */}
        <MarkdownText source={item.body} />
      </Card>
      {item.link && <Button title="Open link" variant="secondary" onPress={() => Linking.openURL(item.link!)} />}
      <ErrorText error={error} />
      {canDelete && (
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
