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

import { ActionMenu, type MenuAction, openReport, useBlockAction } from '@/components/ContentMenu';
import { EmptyState, ErrorText, RoleBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { confirmDestructive } from '@/lib/confirm';
import { newId } from '@/lib/id';
import { personName } from '@/lib/deleteAccount';
import { canReport } from '@/lib/roles';
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
  /** ARU-158: takes a deleted message off the list at once (realtime also delivers the deletion). */
  remove: (id: string) => void;
};

/**
 * The chat screen body shared by the course chat (ARU-8) and the general chat (ARU-61): an inverted message list
 * (newest at the bottom, older pages on scroll up) and a composer that stays above the keyboard.
 * - `emptyText`: shown when the chat has no messages yet.
 * - `unknownAuthor`: the name shown when the author's profile can't be read. An author who deleted their account
 *   (no author any more, ARU-75) shows as "Deleted account", without a role badge.
 * - `badges`: extra badges after the role badge (the course chat's "Owner").
 * - `kind`: what a report on a message is about (ARU-158); `canDelete`: the user may delete any message here (the
 *   teacher; a course's owner in its chat). Long-press a message for Report (someone else's) and Delete.
 */
export function ChatView<M extends ChatMessage>({
  chat,
  emptyText,
  unknownAuthor,
  badges,
  kind,
  canDelete = false,
}: {
  chat: ChatState<M>;
  emptyText: string;
  unknownAuthor: string;
  badges?: (message: M) => ReactNode;
  kind: 'course_message' | 'general_message';
  canDelete?: boolean;
}) {
  const { currentUser, deleteChatMessage } = useStore();
  const { t } = useI18n();
  // ARU-158: the message whose menu is open, and the result of deleting one.
  const [menuFor, setMenuFor] = useState<M | null>(null);
  const deletion = useAction();
  const blockAction = useBlockAction();

  function actionsFor(message: M): MenuAction[] {
    const actions: MenuAction[] = [];
    if (canReport(currentUser, message.authorId)) {
      actions.push({ key: 'report', label: t('report.menuReport'), onPress: () => openReport(kind, message.id) });
    }
    // ARU-162 AC 1: Block <name>, after Report; the chat then hides their messages at once (useChat).
    const block = blockAction(message.authorId);
    if (block) actions.push(block);
    if (canDelete) {
      actions.push({
        key: 'delete',
        label: t('report.menuDelete'),
        destructive: true,
        onPress: () => {
          confirmDestructive(t('chat.deleteTitle'), t('chat.deleteMessage'), t('chat.deleteConfirm')).then((ok) => {
            if (!ok) return;
            deletion.run(async () => {
              await deleteChatMessage(kind, message.id);
              chat.remove(message.id);
            });
          });
        },
      });
    }
    return actions;
  }
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
            actions={actionsFor(item)}
            onOpenMenu={() => setMenuFor(item)}
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
      <ActionMenu visible={!!menuFor} actions={menuFor ? actionsFor(menuFor) : []} onClose={() => setMenuFor(null)} />
      <View style={chatStyles.composer}>
        <ErrorText error={error ?? deletion.error ?? chat.error} />
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
  actions,
  onOpenMenu,
}: {
  message: ChatMessage;
  mine: boolean;
  unknownAuthor: string;
  badges?: ReactNode;
  actions: MenuAction[];
  onOpenMenu: () => void;
}) {
  const { getUser } = useStore();
  const { t } = useI18n();
  const author = message.authorId == null ? undefined : getUser(message.authorId);
  const hasActions = actions.length > 0;
  return (
    // ARU-158 AC 1 / 11: long-press (a long click on web) opens the message's menu. Screen readers get the same
    // actions as accessibility actions, since a long-press is hard to find there.
    <Pressable
      testID={`chat-message-${message.id}`}
      onLongPress={hasActions ? onOpenMenu : undefined}
      accessibilityHint={hasActions ? t('report.messageActionsHint') : undefined}
      accessibilityActions={hasActions ? actions.map((a) => ({ name: a.key, label: a.label })) : undefined}
      onAccessibilityAction={(e) => actions.find((a) => a.key === e.nativeEvent.actionName)?.onPress()}
      style={[chatStyles.bubble, mine ? chatStyles.mine : chatStyles.theirs]}>
      <View style={chatStyles.meta}>
        <Text style={[styles.label, { flexShrink: 1 }]} numberOfLines={1}>
          {personName(message.authorId, author, unknownAuthor)}
        </Text>
        {author && <RoleBadge role={author.role} />}
        {badges}
      </View>
      <Text style={styles.body}>{message.body}</Text>
      <Text style={styles.muted}>{formatDateTime(message.createdAt)}</Text>
    </Pressable>
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
