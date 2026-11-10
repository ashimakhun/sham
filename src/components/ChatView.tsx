import Ionicons from '@expo/vector-icons/Ionicons';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { Text, TextInput } from '@/components/AppText';

import { EmptyState, ErrorText, RoleBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
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
  const { t } = useI18n();
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
            accessibilityLabel={t('chat.messageLabel')}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            maxLength={MAX_MESSAGE_LENGTH}
            multiline
            style={[styles.input, chatStyles.input]}
          />
          <SendButton label={t('chat.send')} busy={busy} disabled={!text.trim() || busy} onPress={send} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * ARU-138: the composer's send button, a 44 × 44 indigo square (10 pt corners) with a white paper plane, the same in
 * every language. While sending it shows "…" instead. The label stays "Send" / "Отправить" in every state, so screen
 * readers never read "…". Fixed size, so the row doesn't jump between states or stretch when the field grows.
 */
function SendButton({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      testID="chat-send"
      style={({ pressed }) => [chatStyles.send, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.8 }]}>
      {busy ? (
        <Text style={chatStyles.sendBusy} allowFontScaling={false} accessibilityElementsHidden importantForAccessibility="no">
          …
        </Text>
      ) : (
        <Ionicons name="send" size={22} color="#fff" accessibilityElementsHidden importantForAccessibility="no" />
      )}
    </Pressable>
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
  send: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBusy: { color: '#fff', fontSize: 18, lineHeight: 22 },
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
