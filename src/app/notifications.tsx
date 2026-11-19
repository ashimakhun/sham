import { ScrollView } from 'react-native';

import { NotificationSettings } from '@/components/Notifications';
import { styles } from '@/components/ui';

/** ARU-166: the Notifications page, opened from the Profile tab's "Notifications" button. */
export default function NotificationsScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <NotificationSettings />
    </ScrollView>
  );
}
