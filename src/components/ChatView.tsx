import { useHeaderHeight } from 'expo-router/react-navigation';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
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
import { personName } from '@/lib/deleteAccount';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { ChatMessage } from '@/lib/types';
import { useAction } from '@/lib/useAction';

export const MAX_MESSAGE_LENGTH = 2000;

type ChatState<M extends ChatMessage> = {
  messages: M[];
  loaded: boolean;
  loadingOlder: boolean;
  error: string | null;
  loadOlder: () => void;
  send: (id: string, body: string) => Promise<void>;
};

/**
 * The chat screen body shared by the course chat (ARU-8) and the general chat (ARU-61): an inverted message list
 * (newest at the bottom, older pages on scroll up) and a composer that stays above the keyboard.
 * - `emptyText`: shown when the chat has no messages yet.
 * - `unknownAuthor`: the name shown when the author's profile can't be read. An author who deleted their account
 *   (no author any more, ARU-75) shows as "Deleted account", without a role badge.
 * - `badges`: extra badges after the role badge (the course chat's "Owner").
 */
export function ChatView<M extends ChatMessage>({
  chat,
  emptyText,
  unknownAuthor,
  badges,
}: {
  chat: ChatState<M>;
  emptyText: string;
  unknownAuthor: string;
  badges?: (message: M) => ReactNode;
}) {
  const { currentUser } = useStore();
  const headerHeight = useHeaderHeight();
  const [text, setText] = useState('');
  // One id per message, kept across retries so a retry never posts twice; renewed after a send.
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
      {/* Inverted: newest at the bottom, opens scrolled to it; scrolling up loads older pages. Dragging the list
          closes the keyboard. */}
      <FlatList
        inverted
        style={styles.screen}
        contentContainerStyle={[styles.content, { flexGrow: 1 }]}
        data={chat.messages}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        renderItem={({ item }) => (
          <Bubble
            message={item}
            mine={item.authorId != null && item.authorId === currentUser?.id}
            unknownAuthor={unknownAuthor}
            badges={badges?.(item)}
          />
        )}
        onEndReached={() => chat.loadOlder()}
        onEndReachedThreshold={0.3}
        ListFooterComponent={chat.loadingOlder ? <ActivityIndicator style={{ marginVertical: 8 }} /> : undefined}
        ListEmptyComponent={
          chat.loaded ? (
            // The list is inverted, so flip the empty state back upright.
            <View style={{ transform: [{ scaleY: -1 }] }}>
              <EmptyState title={emptyText} />
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
            maxLength={MAX_MESSAGE_LENGTH}
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

function Bubble({
  message,
  mine,
  unknownAuthor,
  badges,
}: {
  message: ChatMessage;
  mine: boolean;
  unknownAuthor: string;
  badges?: ReactNode;
}) {
  const { getUser } = useStore();
  const author = message.authorId == null ? undefined : getUser(message.authorId);
  return (
    <View style={[chatStyles.bubble, mine ? chatStyles.mine : chatStyles.theirs]}>
      <View style={chatStyles.meta}>
        <Text style={[styles.label, { flexShrink: 1 }]} numberOfLines={1}>
          {personName(message.authorId, author, unknownAuthor)}
        </Text>
        {author && <RoleBadge role={author.role} />}
        {badges}
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
