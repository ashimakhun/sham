import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Text } from '@/components/AppText';

import { styles } from '@/components/ui';
import { canSeeListeners } from '@/components/ListenersList';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Course } from '@/lib/types';

/**
 * ARU-97: on course details, Listeners is one "LISTENERS (n) >" row that opens the Listeners page.
 * The list, remove (X) and "+ Add listeners" live on that page (src/app/courses/[id]/members.tsx).
 */
export function ListenersSection({ course }: { course: Course }) {
  const { currentUser, courseMembers } = useStore();
  if (!canSeeListeners(currentUser, course.id, courseMembers)) return null;
  const count = courseMembers.filter((m) => m.courseId === course.id).length;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Listeners (${count})`}
      accessibilityHint="Opens the list of listeners"
      testID="listeners-row"
      onPress={() => router.push({ pathname: '/courses/[id]/members', params: { id: course.id } })}
      style={({ pressed }) => [
        styles.card,
        { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
        pressed && { opacity: 0.7 },
      ]}>
      <Text style={[styles.label, { flex: 1 }]}>LISTENERS ({count})</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}
