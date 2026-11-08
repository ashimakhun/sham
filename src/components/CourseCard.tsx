import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { DisciplineLabel } from '@/components/Disciplines';
import { Card, HiddenBadge, OwnerLine, UnreadBadge, styles } from '@/components/ui';
import { paymentDueText } from '@/lib/billing';
import { feedbackFor, ratingSummary, ratingSummaryLabel } from '@/lib/feedback';
import { inCourseChat, seesOnlyCourseSummary } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { withUnreadLabel } from '@/lib/unread';
import { font } from '@/lib/fonts';

type Props = {
  course: Course;
  /** Optional relation tag shown above the title (ARU-12). Since ARU-81 no screen passes one: the Courses tab's
   *  section headings say which courses the user is in or owns, so cards start with the title. */
  tag?: string;
  /** Called just before the details or chat screen opens (keeps the Courses tab view). */
  onOpen?: () => void;
  /** ARU-66: the signed-in listener owes this course; the deadline (YYYY-MM-DD). Red border and a "Payment due" line. */
  paymentDue?: string;
};

/** A second tap within this window is ignored, so a quick double tap opens only one screen (ARU-25). */
const TAP_GUARD_MS = 800;

export function CourseCard({ course, tag, onOpen, paymentDue }: Props) {
  const { getUser, currentUser, courseMembers, unreadCount, courseFeedback } = useStore();
  // A student who is not a listener sees only the title and description (ARU-24).
  const summaryOnly = seesOnlyCourseSummary(currentUser, course, courseMembers);
  // The chat icon shows only to people in the course chat; it follows live store updates (ARU-25).
  const showChat = inCourseChat(currentUser, course, courseMembers);
  // New messages from others since the user last read this chat (ARU-31); only for people in the chat.
  const unread = showChat ? unreadCount(course.id) : 0;
  // Average rating and count (ARU-53); nothing when the course has no feedback.
  const feedback = feedbackFor(courseFeedback, course.id);
  const rating = ratingSummary(feedback);
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
      {course.hidden ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.title, { flexShrink: 1 }]} numberOfLines={2}>
            {course.title}
          </Text>
          <HiddenBadge />
        </View>
      ) : (
        <Text style={styles.title} numberOfLines={2}>
          {course.title}
        </Text>
      )}
      {/* ARU-63 AC 6: only a discipline the viewer can see. */}
      <DisciplineLabel course={course} />
      {course.description ? (
        <Text style={styles.body} numberOfLines={2}>
          {course.description}
        </Text>
      ) : null}
      {!summaryOnly && (
        <OwnerLine name={getUser(course.createdById)?.name ?? 'Unknown'} date={formatDate(course.createdAt)} />
      )}
      {rating ? (
        <Text style={styles.muted} accessibilityLabel={ratingSummaryLabel(feedback)}>
          {rating}
        </Text>
      ) : null}
      {/* ARU-66 AC 7: read with the card's other text by screen readers. */}
      {paymentDue ? (
        <Text testID={`payment-due-${course.id}`} style={{ color: colors.danger, fontSize: 14, ...font(500) }}>
          {paymentDueText(paymentDue)}
        </Text>
      ) : null}
    </>
  );
  // A thin (1 pt) red border in the theme's red.
  const dueBorder = paymentDue ? { borderWidth: 1, borderColor: colors.danger } : null;

  if (!showChat)
    return (
      <Card onPress={() => open('/courses/[id]')} style={dueBorder ?? undefined}>
        {content}
      </Card>
    );

  return (
    // The card opts out of accessibility grouping so screen readers reach the chat icon on its own; the content
    // column is then its own button that opens the details (ARU-27). It has no explicit label, so screen readers read
    // its text like a card without the icon: tag, title, description and owner line (ARU-34).
    <Card
      onPress={() => open('/courses/[id]')}
      accessible={false}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, ...dueBorder }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => open('/courses/[id]')}
        style={{ flex: 1, gap: 8 }}>
        {content}
      </Pressable>
      {/* A nested Pressable takes the touch itself, so the card's onPress does not also fire. */}
      <Pressable
        accessibilityRole="button"
        // The count is only in the icon's label, never the content's (ARU-34): unchanged at 0 (ARU-31 AC 11).
        accessibilityLabel={withUnreadLabel(`Open chat for ${course.title}`, unread)}
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
        {/* Centred on the 24 pt icon's top-right corner (it spans 10–34 in the 44×44 target), so it covers part of the
            bubble's outline (ARU-57). Anchored by `right`, so a wider "99+" pill grows inwards over the icon and stays
            inside the target and the content column keeps its size. */}
        <UnreadBadge count={unread} ring style={{ position: 'absolute', top: 0, right: 0 }} />
      </Pressable>
    </Card>
  );
}
