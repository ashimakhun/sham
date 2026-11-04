import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { AccountantSection } from '@/components/Accountant';
import { ProfileNameCard } from '@/components/ProfileNameCard';
import { TelegramCard } from '@/components/TelegramCard';
import { Button, ErrorText, styles } from '@/components/ui';
import { canManageRoles, canUseGeneralChat } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

export default function ProfileScreen() {
  const { currentUser, signOut, accessRequests, generalUnreadCount } = useStore();
  const { busy, error, run } = useAction();
  if (!currentUser) return null;

  const pending = accessRequests.filter((r) => r.status === 'pending').length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ProfileNameCard />

      {/* ARU-100: right below the name card, above every other section, for every role.
          No wrapper, so it gets the same gap as the other sections. */}
      {canUseGeneralChat(currentUser) && (
        // ARU-69: the chat icon instead of the words; read as "Open general chat".
        // ARU-72: new messages show as a badge and join the label. ARU-78: the badge sits on the icon, as on a course card.
        <Button
          title="Open general chat"
          icon="chatbubble-outline"
          badgeOnIcon
          variant="secondary"
          unread={generalUnreadCount}
          onPress={() => router.push('/general-chat')}
        />
      )}

      {/* ARU-98: no course cards here; courses are listed on the Courses tab. */}
      <TelegramCard />
      {/* ARU-65: accountants and the teacher. */}
      <AccountantSection />

      <View style={{ gap: 10, marginTop: 8 }}>
        {canManageRoles(currentUser.role) && (
          <Button
            // Accounts waiting for approval (ARU-43), e.g. "Manage roles (2)"; no count when there are none.
            title={pending > 0 ? `Manage roles (${pending})` : 'Manage roles'}
            variant="secondary"
            onPress={() => router.push('/roles')}
          />
        )}
        {/* ARU-76: own password only; waiting / declined accounts never get here (AccessGate). */}
        <Button title="Change password" variant="secondary" onPress={() => router.push('/change-password')} />
        <ErrorText error={error} />
        {/* The root screen redirects to sign-in once the session is gone. */}
        <Button title="Sign out" variant="secondary" disabled={busy} onPress={() => run(signOut)} />
        {/* ARU-75: last in the group; the teacher's account can't be deleted. */}
        {currentUser.role !== 'teacher' && (
          <Button title="Delete account" variant="danger" disabled={busy} onPress={() => router.push('/delete-account')} />
        )}
      </View>
    </ScrollView>
  );
}
