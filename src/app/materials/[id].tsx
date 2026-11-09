import { router, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView } from 'react-native';

import { LikerRow, LikeRow, likesOf } from '@/components/LikeHeart';
import { MarkdownText } from '@/components/MarkdownText';
import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';
import { formatDate } from '@/lib/theme';
import { Text } from '@/components/AppText';

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { materials, materialLikes, currentUser, getUser, deleteMaterial } = useStore();
  const { busy, error, run } = useAction();
  const { t } = useI18n();

  const item = materials.find((m) => m.id === id);
  if (!item) return <EmptyState title={t('materials.notFound')} />;
  // Only the author, and only while they are still a teacher or mentor (a mentor made student can't delete).
  const canDelete =
    currentUser?.id === item.teacherId && (currentUser.role === 'teacher' || currentUser.role === 'mentor');
  // Likes (ARU-52), newest first, counting only likers whose profile loads (AC 8); same helper as the Blog card.
  const { likers, liked, count } = likesOf(item.id, materialLikes, getUser, currentUser?.id);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <Card>
        <Text style={styles.h1}>{item.title}</Text>
        {/* ARU-120: the like heart and count sit at the right of the author · date line; its error shows here. */}
        <LikeRow materialId={item.id} liked={liked} count={count}>
          <Text style={styles.muted}>
            {getUser(item.teacherId)?.name} · {formatDate(item.createdAt)}
          </Text>
        </LikeRow>
        {/* Formatted (ARU-38); old plain-text posts keep their text and line breaks. */}
        <MarkdownText source={item.body} />
      </Card>
      {/* ARU-120: who liked it, newest first, each with a filled heart; hidden at 0 likes. */}
      {count > 0 && (
        <Card testID="liked-by">
          {likers.map((u) => (
            <LikerRow key={u.id} name={u.name} />
          ))}
        </Card>
      )}
      {item.link && <Button title={t('materials.openLink')} variant="secondary" onPress={() => Linking.openURL(item.link!)} />}
      <ErrorText error={error} />
      {canDelete && (
        <Button
          title={busy ? t('materials.deleting') : t('materials.deleteMaterial')}
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
