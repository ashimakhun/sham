import { FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { usePhotoZipDownload } from '@/components/PhotoDownload';
import { EmptyState, ErrorText, styles } from '@/components/ui';
import { storedOwnPhotos, zipEntries, type ZipEntry } from '@/lib/photoRetention';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { font } from '@/lib/fonts';

/**
 * ARU-107 AC 6: Download by course, for a sender with more photos than one ZIP holds. One entry per course with its
 * photo count; a course with more than 50 photos comes in parts. Each entry downloads its own ZIP, with its own
 * "Preparing…" state and error.
 */
export default function DownloadByCourseScreen() {
  const { currentUser, visibleHomework, getCourse } = useStore();
  const photos = storedOwnPhotos(visibleHomework, currentUser?.id);
  const entries = zipEntries(photos, (id) => getCourse(id)?.title);

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      data={entries}
      keyExtractor={(e) => e.key}
      ListHeaderComponent={
        <Text style={styles.muted}>Your homework photos, one ZIP per course (at most 50 photos each).</Text>
      }
      renderItem={({ item }) => <EntryRow entry={item} />}
      ListEmptyComponent={<EmptyState title="No photos to download" />}
    />
  );
}

function EntryRow({ entry }: { entry: ZipEntry }) {
  // Part entries are never a total over 50: the course and part are always passed.
  const { busy, error, download } = usePhotoZipDownload(entry.count);
  const label =
    `${entry.title}${entry.parts > 1 ? ` · Part ${entry.part} of ${entry.parts}` : ''} · ` +
    `${entry.count} ${entry.count === 1 ? 'photo' : 'photos'}`;
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Download ${label}`}
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
            {entry.parts > 1 ? `Part ${entry.part} of ${entry.parts} · ` : ''}
            {entry.count} {entry.count === 1 ? 'photo' : 'photos'}
          </Text>
        </View>
        <Text style={{ color: colors.primary, ...font(500) }}>{busy ? 'Preparing…' : 'Download'}</Text>
      </Pressable>
      <ErrorText error={error} />
    </View>
  );
}
