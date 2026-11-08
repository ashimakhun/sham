import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';

import { EditCourseDisciplineSection } from '@/components/Disciplines';
import { Card, EmptyState, styles } from '@/components/ui';
import { canChangeOwner } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { font } from '@/lib/fonts';

/** A second tap within this window is ignored, so a double tap opens the Change owner picker only once. */
const TAP_GUARD_MS = 800;

/**
 * ARU-103: Edit course, opened as a modal from the pencil in the course name card. A Discipline section (teacher on any
 * course, a mentor on a course they own) and an Owner section whose "Change owner" row opens the existing picker.
 * Everything is derived from the live store at render time, so a role change, an owner change or a deleted course
 * shows up without reopening the screen.
 */
export default function EditCourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, getCourse, getUser } = useStore();
  const lastTap = useRef(0);

  const course = getCourse(id);
  if (currentUser && !canChangeOwner(currentUser.role)) {
    return <EmptyState title="Not allowed" hint="Only the teacher or a mentor can edit a course." />;
  }
  if (!course) return <EmptyState title="Course not found" />;

  const ownerName = getUser(course.createdById)?.name ?? 'Unknown';
  const openOwnerPicker = () => {
    const now = Date.now();
    if (now - lastTap.current < TAP_GUARD_MS) return;
    lastTap.current = now;
    router.push({ pathname: '/courses/[id]/owner', params: { id: course.id } });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <EditCourseDisciplineSection course={course} />
      <Card style={{ gap: 8 }}>
        <View style={{ gap: 2 }} accessible accessibilityLabel={`Owner, ${ownerName}`}>
          <Text style={styles.label}>Owner</Text>
          <Text style={styles.body} numberOfLines={2}>
            {ownerName}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change owner"
          onPress={openOwnerPicker}
          style={({ pressed }) => [
            styles.input,
            { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
            pressed && { opacity: 0.7 },
          ]}>
          <Text style={[styles.body, { flex: 1, color: colors.primary, ...font(500) }]}>Change owner</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
      </Card>
    </ScrollView>
  );
}
