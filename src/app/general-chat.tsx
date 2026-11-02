import { ChatView } from '@/components/ChatView';
import { EmptyState } from '@/components/ui';
import { canUseGeneralChat } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useGeneralChat } from '@/lib/useCourseChat';

/** ARU-61: one chat for every approved user (any role), opened from the Profile tab. Waiting and declined accounts
 *  never get here (AccessGate, ARU-43); the database also returns them nothing (0029_general_chat.sql). */
export default function GeneralChatScreen() {
  const { currentUser } = useStore();
  const allowed = canUseGeneralChat(currentUser);
  const chat = useGeneralChat(allowed);
  if (!allowed) return <EmptyState title="Not available" hint="The general chat is for accepted accounts." />;
  return <ChatView chat={chat} emptyText="No messages yet. Say hello to everyone!" unknownAuthor="Unknown user" />;
}
