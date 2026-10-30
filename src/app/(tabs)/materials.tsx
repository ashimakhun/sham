import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { Button, Card, EmptyState, FilterChips, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/theme';

const ALL = 'all';

export default function MaterialsScreen() {
  const { currentUser, loading, refresh, materials, getUser } = useStore();
  // Teachers and mentors share materials (ARU-26); students only read.
  const canShare = currentUser?.role === 'teacher' || currentUser?.role === 'mentor';
  // Author filter (ARU-29): kept while the tab stays mounted (tab switches, opening a material, sharing one);
  // starts at All after sign-in. Filtering is on the loaded list only: no network call.
  const [selected, setSelected] = useState<string>(ALL);

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

  const header =
    canShare || materials.length > 0 ? (
      <View style={{ gap: 12 }}>
        {canShare && <Button title="+ Share material" onPress={() => router.push('/materials/new')} />}
        {materials.length > 0 && (
          <FilterChips options={[{ value: ALL, label: 'All' }, ...authors]} value={filter} onChange={setSelected} />
        )}
      </View>
    ) : undefined;

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
            {item.body}
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
