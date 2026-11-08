import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { ChatView } from '@/components/ChatView';
import { EmptyState } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { canUseGeneralChat } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useGeneralChat } from '@/lib/useCourseChat';

/** ARU-72: while the general chat is open everything shown is read: on open, on each newest message, on leaving and
 *  when the app goes to the background (as useMarkChatRead does for course chats, ARU-31). */
function useMarkGeneralChatRead(newestId: string | undefined) {
  const { markGeneralChatRead, setGeneralChatOpen } = useStore();
  const newest = useRef(newestId);
  useEffect(() => {
    newest.current = newestId;
    if (newestId) markGeneralChatRead(newestId).catch(() => {});
  }, [newestId, markGeneralChatRead]);

  useFocusEffect(
    useCallback(() => {
      setGeneralChatOpen(true);
      return () => {
        setGeneralChatOpen(false);
        if (newest.current) markGeneralChatRead(newest.current).catch(() => {});
      };
    }, [markGeneralChatRead, setGeneralChatOpen]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && newest.current) markGeneralChatRead(newest.current).catch(() => {});
    });
    return () => sub.remove();
  }, [markGeneralChatRead]);
}

function GeneralChat() {
  const { t } = useI18n();
  const chat = useGeneralChat(true);
  useMarkGeneralChatRead(chat.messages[0]?.id);
  return <ChatView chat={chat} emptyText={t('chat.generalEmpty')} unknownAuthor={t('chat.unknownUser')} />;
}

/** ARU-61: one chat for every approved user (any role), opened from the Profile tab. Waiting and declined accounts
 *  never get here (AccessGate, ARU-43); the database also returns them nothing (0029_general_chat.sql). */
export default function GeneralChatScreen() {
  const { currentUser } = useStore();
  const { t } = useI18n();
  if (!canUseGeneralChat(currentUser)) {
    return <EmptyState title={t('chat.notAvailableTitle')} hint={t('chat.notAvailableHint')} />;
  }
  return <GeneralChat />;
}
