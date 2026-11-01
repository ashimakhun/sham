import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { Button, Card, EmptyState, ErrorText, FilterChips, Segmented, styles } from '@/components/ui';
import { formatSize, isAllowedPdf, PDF_RULE } from '@/lib/files';
import { markdownToPlainText } from '@/lib/markdown';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

const ALL = 'all';

type Section = 'blog' | 'kb';
const SECTIONS: { value: Section; label: string }[] = [
  { value: 'blog', label: 'Blog' },
  { value: 'kb', label: 'Knowledge base' },
];

export default function MaterialsScreen() {
  const { currentUser, loading, refresh, materials, materialFiles, getUser, getCourse } = useStore();
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
      setPickError(e instanceof Error ? e.message : 'Could not open the file picker.');
    }
  }

  const authorName = (id: string) => getUser(id)?.name ?? 'Unknown';
  // One chip per author of a currently loaded material, by name (case-insensitive); by id, so same names stay apart.
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

  const sorted = materials
    .filter((m) => filter === ALL || m.teacherId === filter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const header = (
    <View style={{ gap: 12 }}>
      <Segmented<Section> options={SECTIONS} value={section} onChange={setSection} />
      {blog && canShare && <Button title="+ Share material" onPress={() => router.push('/materials/new')} />}
      {blog && materials.length > 0 && (
        <FilterChips options={[{ value: ALL, label: 'All' }, ...authors]} value={filter} onChange={setSelected} />
      )}
      {!blog && canShare && <Button title="+ Upload PDF" onPress={uploadPdf} />}
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
              <Text style={styles.title} numberOfLines={2}>
                {item.name}
              </Text>
              {!!item.description && (
                <Text style={styles.body} numberOfLines={2}>
                  {item.description}
                </Text>
              )}
              <Text style={styles.muted} numberOfLines={1}>
                {authorName(item.authorId)} · {formatDate(item.createdAt)} · {formatSize(item.sizeBytes)}
              </Text>
              {course && (
                <Text style={styles.muted} numberOfLines={1}>
                  Course: {course.title}
                </Text>
              )}
            </Card>
          );
        }}
        ListEmptyComponent={
          <EmptyState title="No books or files yet" hint={canShare ? 'Upload a PDF for your class.' : undefined} />
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
      renderItem={({ item }) => (
        <Card onPress={() => router.push({ pathname: '/materials/[id]', params: { id: item.id } })}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.body} numberOfLines={2}>
            {markdownToPlainText(item.body)}
          </Text>
          <Text style={styles.muted}>
            {getUser(item.teacherId)?.name} · {formatDate(item.createdAt)}
            {item.link ? ' · 🔗 link' : ''}
          </Text>
        </Card>
      )}
      ListEmptyComponent={
        <EmptyState
          title="No materials yet"
          hint={
            canShare
              ? 'Share a lesson, notes or a link with your class.'
              : 'Your teacher and mentors have not shared anything yet.'
          }
        />
      }
    />
  );
}
