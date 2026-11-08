import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Card, styles } from '@/components/ui';
import { formatSize } from '@/lib/files';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';

/**
 * Knowledge base PDFs linked to a course (ARU-39), on the full course details only. Reads the store's materialFiles
 * (newest first, refetched live and on pull-to-refresh), so it shows exactly what the read policy returns. Hidden
 * when no item is linked.
 */
export function CourseMaterialsSection({ course }: { course: Course }) {
  const { materialFiles, getUser } = useStore();
  const items = materialFiles.filter((f) => f.courseId === course.id);
  if (!items.length) return null;

  return (
    <Card style={{ gap: 4 }}>
      <Text style={styles.label} accessibilityRole="header">
        MATERIALS ({items.length})
      </Text>
      {items.map((item, i) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, PDF`}
          onPress={() => router.push({ pathname: '/materials/files/[id]', params: { id: item.id } })}
          style={({ pressed }) => [
            { minHeight: 44, paddingVertical: 8, gap: 2, justifyContent: 'center' },
            i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
            pressed && { opacity: 0.6 },
          ]}>
          <Text style={styles.body} numberOfLines={2}>
            {item.name}
          </Text>
          <View>
            <Text style={styles.muted} numberOfLines={1}>
              {getUser(item.authorId)?.name ?? 'Unknown'} · {formatDate(item.createdAt)} · {formatSize(item.sizeBytes)}
            </Text>
          </View>
        </Pressable>
      ))}
    </Card>
  );
}
