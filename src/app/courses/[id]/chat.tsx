import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, EmptyState, ErrorText, RoleBadge, styles } from '@/components/ui';
import { newId } from '@/lib/id';
import { inCourseChat } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { Course, CourseMessage } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useCourseChat } from '@/lib/useCourseChat';

const MAX_LENGTH = 2000;

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
  const { currentUser } = useStore();
  const headerHeight = useHeaderHeight();
  const chat = useCourseChat(course.id, true);
  useMarkChatRead(course.id, chat.messages[0]?.id);
  const [text, setText] = useState('');
  // One id per message, kept across retries so a retry never posts twice (AC 6); renewed after a send.
  const [messageId, setMessageId] = useState(newId);
  const { busy, error, run } = useAction();

  function send() {
    run(async () => {
      await chat.send(messageId, text);
      setText('');
      setMessageId(newId());
    });
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}>
      {/* Inverted: newest at the bottom, opens scrolled to it; scrolling up loads older pages (AC 3 / AC 7). */}
      <FlatList
        inverted
        style={styles.screen}
        contentContainerStyle={[styles.content, { flexGrow: 1 }]}
        data={chat.messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <Bubble message={item} course={course} mine={item.authorId === currentUser?.id} />}
        onEndReached={() => chat.loadOlder()}
        onEndReachedThreshold={0.3}
        ListFooterComponent={chat.loadingOlder ? <ActivityIndicator style={{ marginVertical: 8 }} /> : undefined}
        ListEmptyComponent={
          chat.loaded ? (
            // The list is inverted, so flip the empty state back upright.
            <View style={{ transform: [{ scaleY: -1 }] }}>
              <EmptyState title="No messages yet — start the discussion" />
            </View>
          ) : (
            <ActivityIndicator style={{ marginVertical: 24 }} />
          )
        }
      />
      <View style={chatStyles.composer}>
        <ErrorText error={error ?? chat.error} />
        <View style={chatStyles.row}>
          <TextInput
            accessibilityLabel="Message"
            placeholder="Write a message…"
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            maxLength={MAX_LENGTH}
            multiline
            style={[styles.input, chatStyles.input]}
          />
          <View style={chatStyles.send}>
            <Button title={busy ? '…' : 'Send'} onPress={send} disabled={!text.trim() || busy} />
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message, course, mine }: { message: CourseMessage; course: Course; mine: boolean }) {
  const { getUser } = useStore();
  const author = getUser(message.authorId);
  return (
    <View style={[chatStyles.bubble, mine ? chatStyles.mine : chatStyles.theirs]}>
      <View style={chatStyles.meta}>
        <Text style={[styles.label, { flexShrink: 1 }]} numberOfLines={1}>
          {author?.name ?? 'Former member'}
        </Text>
        {author && <RoleBadge role={author.role} />}
        {message.authorId === course.createdById && (
          <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>Owner</Text>
          </View>
        )}
      </View>
      <Text style={styles.body}>{message.body}</Text>
      <Text style={styles.muted}>{formatDateTime(message.createdAt)}</Text>
    </View>
  );
}

const chatStyles = StyleSheet.create({
  composer: {
    padding: 12,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, maxHeight: 120 },
  send: { width: 80 },
  bubble: {
    maxWidth: '85%',
    borderRadius: 14,
    padding: 12,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primarySoft },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
});
