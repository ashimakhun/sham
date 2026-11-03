import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text } from 'react-native';

import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { confirmDestructive } from '@/lib/confirm';
import { formatSize, OPEN_FAILED } from '@/lib/files';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

/** Knowledge base item details (ARU-30 AC 5–8). */
export default function MaterialFileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { materialFiles, currentUser, getUser, getCourse, getMaterialFileUrl, deleteMaterialFile } = useStore();
  const { busy, error, run } = useAction();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const item = materialFiles.find((f) => f.id === id);
  if (!item) return <EmptyState title="Material not found" />;
  const course = item.courseId ? getCourse(item.courseId) : undefined;
  // Edit: only the author, and only while they are still a teacher or mentor. Delete: the same, plus the teacher on
  // anyone's PDF (ARU-86, mirrors 0043's policies).
  const canEdit =
    currentUser?.id === item.authorId && (currentUser.role === 'teacher' || currentUser.role === 'mentor');
  const canDelete = canEdit || currentUser?.role === 'teacher';

  async function openPdf() {
    if (!item || opening) return;
    setOpening(true);
    setOpenError(null);
    try {
      // A fresh 60-second link on every tap, never when the list loads.
      await Linking.openURL(await getMaterialFileUrl(item.storagePath));
    } catch {
      setOpenError(OPEN_FAILED);
    } finally {
      setOpening(false);
    }
  }

  function remove() {
    if (!item) return;
    const target = item;
    confirmDestructive('Delete file?', `"${target.name}" and its PDF will be removed for everyone.`, 'Delete').then(
      (ok) => {
        if (!ok) return;
        run(async () => {
          await deleteMaterialFile(target.id);
          if (router.canGoBack()) router.back();
          else router.replace('/materials');
        });
      },
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Card>
        <Text style={styles.h1}>{item.name}</Text>
        <Text style={styles.muted}>
          {getUser(item.authorId)?.name ?? 'Unknown'} · {formatDate(item.createdAt)} · {formatSize(item.sizeBytes)}
        </Text>
        {course && (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Course: ${course.title}`}
            hitSlop={8}
            onPress={() => router.push({ pathname: '/courses/[id]', params: { id: course.id } })}>
            <Text style={[styles.body, { color: colors.primary, fontWeight: '600' }]}>Course: {course.title}</Text>
          </Pressable>
        )}
        {/* ARU-42: everyone who can open a course-only item is in its course, its author or the teacher. */}
        {item.courseOnly && <Text style={styles.muted}>Only people in the course</Text>}
        {!!item.description && <Text style={styles.body}>{item.description}</Text>}
      </Card>
      <Button title={opening ? 'Opening…' : 'Open PDF'} onPress={openPdf} disabled={opening} />
      <ErrorText error={openError} />
      <ErrorText error={error} />
      {canEdit && (
        <Button
          title="Edit"
          variant="secondary"
          disabled={busy}
          onPress={() => router.push({ pathname: '/materials/files/[id]/edit', params: { id: item.id } })}
        />
      )}
      {canDelete && (
        <Button title={busy ? 'Deleting…' : 'Delete'} variant="danger" disabled={busy} onPress={remove} />
      )}
    </ScrollView>
  );
}
