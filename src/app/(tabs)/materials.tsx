import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { AuthorFilter } from '@/components/AuthorFilter';
import { MarkdownText } from '@/components/MarkdownText';
import { Button, Card, EmptyState, ErrorText, Segmented, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { formatSize, isAllowedPdf, PDF_RULE } from '@/lib/files';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';

const ALL = 'all';

type Section = 'blog' | 'kb';

export default function MaterialsScreen() {
  const { currentUser, loading, refresh, materials, materialFiles, materialLikes, getUser, getCourse } = useStore();
  const { t, lang } = useI18n();
  // ARU-113: built on each render (not a module constant), so a language switch relabels it; the choice stays in state.
  const sections: { value: Section; label: string }[] = [
    { value: 'blog', label: t('materials.sectionBlog') },
    { value: 'kb', label: t('materials.sectionKb') },
  ];
  // Teachers and mentors share materials (ARU-26); students only read.
  const canShare = currentUser?.role === 'teacher' || currentUser?.role === 'mentor';
  // Author filter (ARU-29): kept while the tab stays mounted (tab switches, opening a material, sharing one);
  // starts at All after sign-in. Filtering is on the loaded list only: no network call.
  const [selected, setSelected] = useState<string>(ALL);
  // Blog | Knowledge base (ARU-38): kept here like the author filter, so it survives tab switches and opening a post,
  // and starts at Blog after sign-in (signing out unmounts the tabs).
  const [section, setSection] = useState<Section>('blog');
  const blog = section === 'blog';
  // A picked file that isn't a PDF up to 25 MB is rejected here, before the upload screen (ARU-30 AC 4).
  const [pickError, setPickError] = useState<string | null>(null);

  // On a button press, as the web picker requires. Cancelling changes nothing.
  async function uploadPdf() {
    setPickError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        // Web: a file URL, not a base64 copy of up to 25 MB.
        base64: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      if (!isAllowedPdf(file)) {
        setPickError(PDF_RULE);
        return;
      }
      router.push({
        pathname: '/materials/files/new',
        params: { uri: file.uri, name: file.name ?? '', size: file.size?.toString() ?? '', mimeType: file.mimeType ?? '' },
      });
    } catch (e) {
      setPickError(e instanceof Error ? e.message : t('materials.pickerFailed'));
    }
  }

  const authorName = (id: string) => getUser(id)?.name ?? t('common.unknown');
  // One entry per author of a currently loaded material, by name (case-insensitive); by id, so same names stay apart.
  const authors = [...new Set(materials.map((m) => m.teacherId))]
    .map((id) => ({ value: id, label: authorName(id) }))
    .sort(
      (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.value.localeCompare(b.value),
    );
  // An author whose last material is gone falls back to All, whether it went live or after a refresh.
  const filter = authors.some((a) => a.value === selected) ? selected : ALL;
  // ...and stays on All, even if that author shares again later.
  // (Adjusting state while rendering, as React recommends instead of an effect.)
  if (filter !== selected) setSelected(ALL);

  // Like counts per post (ARU-52), counting only likers whose profile loads, as the post screen does.
  const likeCounts = new Map<string, number>();
  for (const l of materialLikes) {
    if (getUser(l.userId)) likeCounts.set(l.materialId, (likeCounts.get(l.materialId) ?? 0) + 1);
  }

  const sorted = materials
    .filter((m) => filter === ALL || m.teacherId === filter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const header = (
    <View style={{ gap: 12 }}>
      <Segmented<Section> options={sections} value={section} onChange={setSection} />
      {blog && canShare && <Button title={t('materials.shareButton')} onPress={() => router.push('/materials/new')} />}
      {/* ARU-62: one Filter button that opens the author list, in place of the ARU-29 chip row. */}
      {blog && materials.length > 0 && (
        <AuthorFilter options={[{ value: ALL, label: t('homework.filterAll') }, ...authors]} value={filter} onChange={setSelected} />
      )}
      {!blog && canShare && <Button title={t('materials.uploadPdfButton')} onPress={uploadPdf} />}
      {!blog && <ErrorText error={pickError} />}
    </View>
  );

  if (!blog) {
    // Knowledge base (ARU-30): every PDF, newest first; it updates live on every device. Pull-to-refresh stays on
    // Blog only, as ARU-38 set it up.
    return (
      <FlatList
        style={styles.screen}
        contentContainerStyle={styles.content}
        data={materialFiles}
        keyExtractor={(f) => f.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => {
          const course = item.courseId ? getCourse(item.courseId) : undefined;
          return (
            <Card onPress={() => router.push({ pathname: '/materials/files/[id]', params: { id: item.id } })}>
              {item.courseOnly && (
                <View style={[styles.badge, { backgroundColor: '#F3F4F6' }]}>
                  <Text style={[styles.badgeText, { color: colors.muted }]}>{t('materials.courseOnly')}</Text>
                </View>
              )}
              <Text style={styles.title} numberOfLines={2}>
                {item.name}
              </Text>
              {!!item.description && (
                <Text style={styles.body} numberOfLines={2}>
                  {item.description}
                </Text>
              )}
              <Text style={styles.muted} numberOfLines={1}>
                {authorName(item.authorId)} · {formatDate(item.createdAt)} · {formatSize(item.sizeBytes, lang)}
              </Text>
              {course && (
                <Text style={styles.muted} numberOfLines={1}>
                  {t('materials.courseLine', { title: course.title })}
                </Text>
              )}
            </Card>
          );
        }}
        ListEmptyComponent={
          <EmptyState title={t('materials.kbEmpty')} hint={canShare ? t('materials.kbEmptyHint') : undefined} />
        }
      />
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={sorted}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => {
        const likes = likeCounts.get(item.id) ?? 0;
        const open = () => router.push({ pathname: '/materials/[id]', params: { id: item.id } });
        return (
          // ARU-54: the whole post, formatted as on the post screen. The card doesn't group its content for screen
          // readers (as in ARU-27), so each link in the body is its own element; the title is the button that opens
          // the post. A tap anywhere else that isn't a link opens it too (the card's own onPress).
          <Card onPress={open} accessible={false}>
            <Pressable accessibilityRole="button" onPress={open}>
              <Text style={styles.title}>{item.title}</Text>
            </Pressable>
            <MarkdownText source={item.body} />
            <Text style={styles.muted}>
              {getUser(item.teacherId)?.name} · {formatDate(item.createdAt)}
              {item.link ? ` · ${t('materials.hasLink')}` : ''}
              {/* Hidden when no one liked it; read as "N likes" by screen readers. */}
              {likes > 0 && (
                <Text accessibilityLabel={t('materials.likes', { count: likes })}>{` · ♥ ${likes}`}</Text>
              )}
            </Text>
          </Card>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          title={t('materials.empty')}
          hint={
            canShare
              ? t('materials.emptyHintShare')
              : t('materials.emptyHintRead')
          }
        />
      }
    />
  );
}
