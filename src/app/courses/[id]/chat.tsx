import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';

import { Text } from '@/components/AppText';

import { ChatView } from '@/components/ChatView';
import { EmptyState, styles } from '@/components/ui';
import { inCourseChat } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Course, CourseMessage } from '@/lib/types';
import { useCourseChat } from '@/lib/useCourseChat';

export default function CourseChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, courseMembers, getCourse } = useStore();
  const course = getCourse(id);
  // Recomputed on every live store update, so removal or an owner change closes the chat (AC 8 / AC 10).
  const inChat = !!course && inCourseChat(currentUser, course, courseMembers);

  if (!course) return <EmptyState title="Course not found" />;
  return (
    <>
      <Stack.Screen options={{ title: course.title }} />
      {inChat ? (
        <Chat course={course} />
      ) : (
        <EmptyState title="You are no longer in this course" hint="Only the course owner, its listeners and the teacher can use this chat." />
      )}
    </>
  );
}

/**
 * ARU-31: while the chat is open it is the store's active chat (no count), and everything up to the newest message
 * shown is marked read: on opening, whenever a message arrives, and again on leaving or going to the background.
 */
function useMarkChatRead(courseId: string, newestId: string | undefined) {
  const { markChatRead, setActiveChat } = useStore();
  const newest = useRef(newestId);
  useEffect(() => {
    newest.current = newestId;
    if (newestId) markChatRead(courseId, newestId).catch(() => {});
  }, [courseId, newestId, markChatRead]);

  useFocusEffect(
    useCallback(() => {
      setActiveChat(courseId);
      return () => {
        setActiveChat(null);
        if (newest.current) markChatRead(courseId, newest.current).catch(() => {});
      };
    }, [courseId, markChatRead, setActiveChat]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && newest.current) markChatRead(courseId, newest.current).catch(() => {});
    });
    return () => sub.remove();
  }, [courseId, markChatRead]);
}

function Chat({ course }: { course: Course }) {
  const chat = useCourseChat(course.id, true);
  useMarkChatRead(course.id, chat.messages[0]?.id);
  return (
    <ChatView
      chat={chat}
      emptyText="No messages yet — start the discussion"
      unknownAuthor="Former member"
      badges={(message: CourseMessage) =>
        // A deleted author (null, ARU-75) is never the owner.
        message.authorId != null && message.authorId === course.createdById ? (
          <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>Owner</Text>
          </View>
        ) : null
      }
    />
  );
}
