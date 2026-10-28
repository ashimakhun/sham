import { useState } from 'react';
import { ActivityIndicator, SectionList, Text, TextInput, View } from 'react-native';

import { Button, EmptyState, ErrorText, RoleBadge, styles } from '@/components/ui';
import { confirmDestructive } from '@/lib/confirm';
import { canManageRoles } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Role, User } from '@/lib/types';
import { useAction } from '@/lib/useAction';

const SECTIONS: { role: Role; title: string }[] = [
  { role: 'teacher', title: 'Teacher' },
  { role: 'mentor', title: 'Mentors' },
  { role: 'student', title: 'Students' },
];

/** The teacher switches users between student and mentor (ARU-13). set_user_role() enforces every rule. */
export default function RolesScreen() {
  const { currentUser, users, courses, dataLoaded, loading, refresh, setUserRole } = useStore();
  const [query, setQuery] = useState('');
  const { busy, error, run } = useAction();

  // While the store is still loading, show a spinner rather than the denial.
  if (!dataLoaded) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!canManageRoles(currentUser?.role)) {
    return <EmptyState title="Only the teacher can manage roles" />;
  }

  const q = query.trim().toLowerCase();
  const sections = SECTIONS.map((s) => ({
    title: s.title,
    data: users
      .filter((u) => u.role === s.role && u.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((s) => s.data.length > 0); // a section with no users is hidden

  function makeMentor(user: User) {
    run(async () => {
      const ok = await confirmDestructive(
        'Make mentor',
        `Make ${user.name} a mentor? They will be able to see and check all students' homework and photos in every course.`,
        'Make mentor',
      );
      if (ok) await setUserRole(user.id, 'mentor');
    });
  }

  function makeStudent(user: User) {
    run(async () => {
      // Friendly early refusal from the loaded courses; the database is the authority if this list is stale.
      const owned = courses
        .filter((c) => c.createdById === user.id)
        .map((c) => c.title)
        .sort((a, b) => a.localeCompare(b));
      if (owned.length) {
        throw new Error(`${user.name} owns ${owned.length} course(s): ${owned.join(', ')}. Reassign them first`);
      }
      const ok = await confirmDestructive(
        'Make student',
        `Make ${user.name} a student? They will only see their own homework and can no longer check homework.`,
        'Make student',
      );
      if (ok) await setUserRole(user.id, 'student');
    });
  }

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      sections={sections}
      initialNumToRender={30}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(u) => u.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          <TextInput
            accessibilityLabel="Search users"
            placeholder="Search by name"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            style={styles.input}
          />
          <ErrorText error={error} />
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[styles.label, { marginTop: 8 }]}>{section.title.toUpperCase()}</Text>
      )}
      renderItem={({ item }) => (
        <View testID={`user-${item.id}`} style={[styles.input, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}>
            <Text style={styles.body} numberOfLines={2}>
              {item.name}
            </Text>
            <RoleBadge role={item.role} />
          </View>
          {/* The teacher's row has no action: nothing in the app makes anyone a teacher. */}
          {item.role === 'student' && (
            <Button title="Make mentor" variant="secondary" disabled={busy} onPress={() => makeMentor(item)} />
          )}
          {item.role === 'mentor' && (
            <Button title="Make student" variant="secondary" disabled={busy} onPress={() => makeStudent(item)} />
          )}
        </View>
      )}
      ListEmptyComponent={
        q ? <EmptyState title={`No users match '${query.trim()}'`} /> : <EmptyState title="No users yet" />
      }
    />
  );
}
