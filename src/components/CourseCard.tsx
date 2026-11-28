import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View, type ViewInstance } from 'react-native';

import { Text } from '@/components/AppText';

import {
  CourseDescriptionDialog,
  DescriptionPreview,
  ShowDescriptionButton,
  focusAfterClose,
} from '@/components/CourseDescription';
import { DisciplineLabel } from '@/components/Disciplines';
import { RatingSummary } from '@/components/RatingSummary';
import { Card, HiddenBadge, OwnerLine, UnreadBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { feedbackFor, ratingSummaryLabel } from '@/lib/feedback';
import { inCourseChat, seesOnlyCourseSummary } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { withUnreadLabel } from '@/lib/unread';

type Props = {
  course: Course;
  /** Optional relation tag shown above the title (ARU-12). Since ARU-81 no screen passes one: the Courses tab's
   *  section headings say which courses the user is in or owns, so cards start with the title. */
  tag?: string;
  /** Called just before the details or chat screen opens (keeps the Courses tab view). */
  onOpen?: () => void;
};

/** A second tap within this window is ignored, so a quick double tap opens only one screen (ARU-25). */
const TAP_GUARD_MS = 800;

export function CourseCard({ course, tag, onOpen }: Props) {
  const { getUser, getDiscipline, currentUser, courseMembers, unreadCount, courseFeedback } = useStore();
  const { t, lang } = useI18n();
  // A student who is not a listener sees only the title and description (ARU-24).
  const summaryOnly = seesOnlyCourseSummary(currentUser, course, courseMembers);
  // The chat icon shows only to people in the course chat; it follows live store updates (ARU-25).
  const showChat = inCourseChat(currentUser, course, courseMembers);
  // New messages from others since the user last read this chat (ARU-31); only for people in the chat.
  const unread = showChat ? unreadCount(course.id) : 0;
  // Average rating and count (ARU-53); nothing when the course has no feedback.
  const feedback = feedbackFor(courseFeedback, course.id);
  const lastTap = useRef(0);
  // ARU-194: whether the description is cut short at 2 lines (measured on the real layout), and its pop-up.
  const [cutShort, setCutShort] = useState(false);
  const showMore = cutShort && !!course.description;
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const showButton = useRef<ViewInstance>(null);
  const closeDescription = () => {
    setDescriptionOpen(false);
    focusAfterClose(showButton);
  };
  const ownerName = getUser(course.createdById)?.name ?? t('common.unknown');

  const open = (pathname: '/courses/[id]' | '/courses/[id]/chat') => {
    const now = Date.now();
    if (now - lastTap.current < TAP_GUARD_MS) return;
    lastTap.current = now;
    onOpen?.();
    router.push({ pathname, params: { id: course.id } });
  };

  // Top of the card: tag, title, discipline and the 2-line description.
  const top = (
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
      {course.description ? <DescriptionPreview text={course.description} onTruncatedChange={setCutShort} /> : null}
    </>
  );
  // Bottom of the card: owner line and rating.
  const bottom = (
    <>
      {!summaryOnly && <OwnerLine name={ownerName} date={formatDate(course.createdAt)} />}
      <RatingSummary items={feedback} style={styles.muted} />
      {/* ARU-161: no payment due / overdue line for listeners (ARU-66 / ARU-148's line and red border removed). */}
    </>
  );
  const content = (
    <>
      {top}
      {bottom}
    </>
  );

  const chatButton = (
    // A nested Pressable takes the touch itself, so the card's onPress does not also fire.
    <Pressable
      accessibilityRole="button"
      // The count is only in the icon's label, never the content's (ARU-34): unchanged at 0 (ARU-31 AC 11).
      accessibilityLabel={withUnreadLabel(t('courses.openChat', { title: course.title }), unread, lang)}
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
  );

  if (showMore) {
    // ARU-194: Show description sits right under the description, outside every open-course Pressable, so screen
    // readers reach it on its own and its tap opens only the pop-up (it never goes through open() or lastTap). The
    // card opts out of grouping (as with the chat icon, ARU-27); the top is the open-course button, and its label
    // reads what the whole card shows (tag, title, discipline, description, owner line, rating: ARU-34). The bottom
    // still opens the course by touch but is hidden from screen readers, since the top's label already reads it.
    const discipline = getDiscipline(course.disciplineId);
    const label = [
      tag,
      course.title,
      course.hidden ? t('common.hidden') : undefined,
      discipline ? t('disciplines.a11yLabel', { name: discipline.name }) : undefined,
      course.description,
      summaryOnly ? undefined : `${t('courses.ownerPrefix')} ${ownerName} · ${formatDate(course.createdAt)}`,
      ratingSummaryLabel(feedback, lang),
    ]
      .filter(Boolean)
      .join(', ');
    const hasBottom = !summaryOnly || feedback.length > 0;
    return (
      <>
        <Card
          onPress={() => open('/courses/[id]')}
          accessible={false}
          style={showChat ? { flexDirection: 'row', alignItems: 'center', gap: 8 } : undefined}>
          <View style={{ flex: showChat ? 1 : undefined, gap: 8 }}>
            <Pressable
              testID="course-card-open"
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => open('/courses/[id]')}
              style={{ gap: 8 }}>
              {top}
            </Pressable>
            <ShowDescriptionButton ref={showButton} title={course.title} onPress={() => setDescriptionOpen(true)} />
            {hasBottom ? (
              <Pressable
                onPress={() => open('/courses/[id]')}
                accessible={false}
                // ARU-201: no keyboard stop either. react-native-web's Pressable renders tabIndex 0 unless -1 is passed.
                focusable={false}
                tabIndex={-1}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                aria-hidden
                style={{ gap: 8 }}>
                {bottom}
              </Pressable>
            ) : null}
          </View>
          {showChat ? chatButton : null}
        </Card>
        {/* Outside the card, so no touch inside the pop-up can reach the card's onPress. */}
        <CourseDescriptionDialog
          visible={descriptionOpen}
          title={course.title}
          description={course.description ?? ''}
          onClose={closeDescription}
        />
      </>
    );
  }

  if (!showChat) return <Card onPress={() => open('/courses/[id]')}>{content}</Card>;

  return (
    // The card opts out of accessibility grouping so screen readers reach the chat icon on its own; the content
    // column is then its own button that opens the details (ARU-27). It has no explicit label, so screen readers read
    // its text like a card without the icon: tag, title, description and owner line (ARU-34).
    <Card
      onPress={() => open('/courses/[id]')}
      accessible={false}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable accessibilityRole="button" onPress={() => open('/courses/[id]')} style={{ flex: 1, gap: 8 }}>
        {content}
      </Pressable>
      {chatButton}
    </Card>
  );
}
