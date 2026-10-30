import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, OwnerLine, styles } from '@/components/ui';
import { inCourseChat, seesOnlyCourseSummary } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';

type Props = {
  course: Course;
  /** Optional relation tag ("Listener" / "Owner") shown above the title (ARU-12). */
  tag?: string;
  /** Called just before the details or chat screen opens (keeps the Courses tab view). */
  onOpen?: () => void;
};

/** A second tap within this window is ignored, so a quick double tap opens only one screen (ARU-25). */
const TAP_GUARD_MS = 800;

export function CourseCard({ course, tag, onOpen }: Props) {
  const { getUser, currentUser, courseMembers } = useStore();
  // A student who is not a listener sees only the title and description (ARU-24).
  const summaryOnly = seesOnlyCourseSummary(currentUser, course, courseMembers);
  // The chat icon shows only to people in the course chat; it follows live store updates (ARU-25).
  const showChat = inCourseChat(currentUser, course, courseMembers);
  const lastTap = useRef(0);

  const open = (pathname: '/courses/[id]' | '/courses/[id]/chat') => {
    const now = Date.now();
    if (now - lastTap.current < TAP_GUARD_MS) return;
    lastTap.current = now;
    onOpen?.();
    router.push({ pathname, params: { id: course.id } });
  };

  const content = (
    <>
      {tag ? (
        <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
          <Text style={[styles.badgeText, { color: colors.primary }]} numberOfLines={1}>
            {tag}
          </Text>
        </View>
      ) : null}
      <Text style={styles.title} numberOfLines={2}>
        {course.title}
      </Text>
      {course.description ? (
        <Text style={styles.body} numberOfLines={2}>
          {course.description}
        </Text>
      ) : null}
      {!summaryOnly && (
        <OwnerLine name={getUser(course.createdById)?.name ?? 'Unknown'} date={formatDate(course.createdAt)} />
      )}
    </>
  );

  if (!showChat) return <Card onPress={() => open('/courses/[id]')}>{content}</Card>;

  return (
    // The card opts out of accessibility grouping so screen readers reach the chat icon on its own; the content
    // column is then its own button that opens the details (ARU-27).
    <Card
      onPress={() => open('/courses/[id]')}
      accessible={false}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={course.title}
        onPress={() => open('/courses/[id]')}
        style={{ flex: 1, gap: 8 }}>
        {content}
      </Pressable>
      {/* A nested Pressable takes the touch itself, so the card's onPress does not also fire. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open chat for ${course.title}`}
        onPress={() => open('/courses/[id]/chat')}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? colors.primarySoft : 'transparent',
        })}>
        <Ionicons name="chatbubble-outline" size={24} color={colors.primary} />
      </Pressable>
    </Card>
  );
}
