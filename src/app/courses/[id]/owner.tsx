import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';

import { EmptyState, ErrorText, RoleBadge, styles } from '@/components/ui';
import { canChangeOwner } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

/** Pick a new course owner (ARU-9). Tapping a person changes the owner at once (no confirmation, decision 7). */
export default function ChangeOwnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, users, courseMembers, getCourse, changeCourseOwner } = useStore();
  const { busy, error, run } = useAction();

  const course = getCourse(id);
  if (currentUser && !canChangeOwner(currentUser.role)) {
    return <EmptyState title="Not allowed" hint="Only the teacher or a mentor can change a course's owner." />;
  }
  if (!course) return <EmptyState title="Course not found" />;

  const courseId = course.id;
  const listenerIds = new Set(courseMembers.filter((m) => m.courseId === courseId).map((m) => m.userId));
  // Every teacher and mentor except the current owner; never students (AC 4).
  const candidates = users
    .filter((u) => (u.role === 'teacher' || u.role === 'mentor') && u.id !== course.createdById)
    .sort((a, b) => a.name.localeCompare(b.name));

  function pick(userId: string) {
    run(async () => {
      await changeCourseOwner(courseId, userId);
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/courses/[id]', params: { id: courseId } });
    });
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      data={candidates}
      keyExtractor={(u) => u.id}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          <Text style={styles.muted} numberOfLines={2}>
            Choose the new owner of {course.title}. The change is made as soon as you tap a name.
          </Text>
          <ErrorText error={error} />
        </View>
      }
      renderItem={({ item }) => {
        // A listener of this course can't become its owner (AC 6); also enforced by the database.
        const isListener = listenerIds.has(item.id);
        const disabled = isListener || busy;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.name}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => pick(item.id)}
            style={({ pressed }) => [
              styles.input,
              { gap: 4 },
              pressed && { backgroundColor: colors.primarySoft },
              disabled && { opacity: 0.5 },
            ]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                {item.name}
              </Text>
              <RoleBadge role={item.role} />
            </View>
            {isListener && <Text style={styles.muted}>Listener of this course — remove them first</Text>}
          </Pressable>
        );
      }}
      ListEmptyComponent={<EmptyState title="No other teachers or mentors to choose from" />}
    />
  );
}
