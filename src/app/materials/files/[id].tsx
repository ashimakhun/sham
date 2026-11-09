import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView } from 'react-native';

import { Text } from '@/components/AppText';

import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { confirmDestructive } from '@/lib/confirm';
import { formatSize, OPEN_FAILED } from '@/lib/files';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import { useAction } from '@/lib/useAction';
import { font } from '@/lib/fonts';

/** Knowledge base item details (ARU-30 AC 5–8). */
export default function MaterialFileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { materialFiles, currentUser, getUser, getCourse, getMaterialFileUrl, deleteMaterialFile } = useStore();
  const { busy, error, run } = useAction();
  const { t, lang } = useI18n();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const item = materialFiles.find((f) => f.id === id);
  if (!item) return <EmptyState title={t('materials.notFound')} />;
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
    confirmDestructive(t('files.deleteTitle'), t('files.deleteMessage', { name: target.name }), t('files.delete')).then(
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
          {getUser(item.authorId)?.name ?? t('common.unknown')} · {formatDate(item.createdAt)} · {formatSize(item.sizeBytes, lang)}
        </Text>
        {course && (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('materials.courseLine', { title: course.title })}
            hitSlop={8}
            onPress={() => router.push({ pathname: '/courses/[id]', params: { id: course.id } })}>
            <Text style={[styles.body, { color: colors.primary, ...font(500) }]}>
              {t('materials.courseLine', { title: course.title })}
            </Text>
          </Pressable>
        )}
        {/* ARU-42: everyone who can open a course-only item is in its course, its author or the teacher. */}
        {item.courseOnly && <Text style={styles.muted}>{t('files.visibilityCourse')}</Text>}
        {!!item.description && <Text style={styles.body}>{item.description}</Text>}
      </Card>
      <Button title={opening ? t('files.opening') : t('files.openPdf')} onPress={openPdf} disabled={opening} />
      <ErrorText error={openError} />
      <ErrorText error={error} />
      {canEdit && (
        <Button
          title={t('files.edit')}
          variant="secondary"
          disabled={busy}
          onPress={() => router.push({ pathname: '/materials/files/[id]/edit', params: { id: item.id } })}
        />
      )}
      {canDelete && (
        <Button title={busy ? t('materials.deleting') : t('files.delete')} variant="danger" disabled={busy} onPress={remove} />
      )}
    </ScrollView>
  );
}
