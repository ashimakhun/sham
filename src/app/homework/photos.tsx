import { FlatList, Pressable, Text, View } from 'react-native';

import { usePhotoZipDownload } from '@/components/PhotoDownload';
import { EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { storedOwnPhotos, zipEntries, type ZipEntry } from '@/lib/photoRetention';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

/**
 * ARU-107 AC 6: Download by course, for a sender with more photos than one ZIP holds. One entry per course with its
 * photo count; a course with more than 50 photos comes in parts. Each entry downloads its own ZIP, with its own
 * "Preparing…" state and error.
 */
export default function DownloadByCourseScreen() {
  const { currentUser, visibleHomework, getCourse } = useStore();
  const photos = storedOwnPhotos(visibleHomework, currentUser?.id);
  const entries = zipEntries(photos, (id) => getCourse(id)?.title);
  const { t } = useI18n();

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      data={entries}
      keyExtractor={(e) => e.key}
      ListHeaderComponent={
        <Text style={styles.muted}>{t('homework.photosByCourseIntro')}</Text>
      }
      renderItem={({ item }) => <EntryRow entry={item} />}
      ListEmptyComponent={<EmptyState title={t('homework.photosNone')} />}
    />
  );
}

function EntryRow({ entry }: { entry: ZipEntry }) {
  // Part entries are never a total over 50: the course and part are always passed.
  const { busy, error, download } = usePhotoZipDownload(entry.count);
  const { t } = useI18n();
  const part = entry.parts > 1 ? t('homework.photosPart', { part: entry.part, parts: entry.parts }) : '';
  const count = t('homework.photoCount', { count: entry.count });
  const label = `${entry.title}${part ? ` · ${part}` : ''} · ${count}`;
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('homework.photosDownloadLabel', { label })}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={() => void download({ courseId: entry.courseId, part: entry.part })}
        style={({ pressed }) => [
          styles.card,
          { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
          pressed && { opacity: 0.7 },
        ]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title} numberOfLines={2}>
            {entry.title}
          </Text>
          <Text style={styles.muted}>
            {part ? `${part} · ${count}` : count}
          </Text>
        </View>
        <Text style={{ color: colors.primary, fontWeight: '600' }}>{busy ? t('homework.photosPreparing') : t('homework.photoDownload')}</Text>
      </Pressable>
      <ErrorText error={error} />
    </View>
  );
}
