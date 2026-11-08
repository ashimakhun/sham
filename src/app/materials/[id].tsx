import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';

import { MarkdownText } from '@/components/MarkdownText';
import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';
import { colors, formatDate } from '@/lib/theme';

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { materials, materialLikes, currentUser, getUser, deleteMaterial, likeMaterial, unlikeMaterial } = useStore();
  const { busy, error, run } = useAction();
  const like = useAction();
  const { t } = useI18n();

  const item = materials.find((m) => m.id === id);
  if (!item) return <EmptyState title={t('materials.notFound')} />;
  // Only the author, and only while they are still a teacher or mentor (a mentor made student can't delete).
  const canDelete =
    currentUser?.id === item.teacherId && (currentUser.role === 'teacher' || currentUser.role === 'mentor');
  // Likes (ARU-52), newest first. Only likers whose profile loads count: the app only loads approved accounts, so
  // likes of accounts that are waiting or declined are not shown (AC 8).
  const likers = materialLikes
    .filter((l) => l.materialId === item.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((l) => getUser(l.userId))
    .filter((u) => u !== undefined);
  const liked = likers.some((u) => u.id === currentUser?.id);
  const count = likers.length;
  const countLabel = t('materials.likes', { count });

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
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={liked ? t('materials.unlikeLabel') : t('materials.likeLabel')}
            accessibilityState={{ selected: liked, disabled: like.busy }}
            disabled={like.busy}
            onPress={() => like.run(() => (liked ? unlikeMaterial(item.id) : likeMaterial(item.id)))}
            style={({ pressed }) => [
              styles.button,
              { paddingHorizontal: 20, backgroundColor: liked ? colors.primary : colors.primarySoft },
              (pressed || like.busy) && { opacity: like.busy ? 0.4 : 0.8 },
            ]}>
            <Text style={[styles.buttonText, { color: liked ? '#fff' : colors.primary }]}>
              {liked ? t('materials.likedButton') : t('materials.likeButton')}
            </Text>
          </Pressable>
          <Text style={styles.muted}>{countLabel}</Text>
        </View>
        <ErrorText error={like.error} />
        {count === 0 ? (
          <Text style={styles.muted}>{t('materials.noLikes')}</Text>
        ) : (
          <View style={{ gap: 4 }} testID="liked-by">
            <Text style={styles.title}>{t('materials.likedBy')}</Text>
            {likers.map((u) => (
              <Text key={u.id} style={styles.body}>
                {u.name}
              </Text>
            ))}
          </View>
        )}
      </Card>
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
