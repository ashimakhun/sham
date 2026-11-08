import { ScrollView, Text } from 'react-native';

import { TelegramSettings } from '@/components/Telegram';
import { styles } from '@/components/ui';
import { telegramBotUsername } from '@/lib/telegram';

/** ARU-101: the Telegram notifications page, opened from the Profile tab's "Telegram notifications" button. */
export default function TelegramScreen() {
  const username = telegramBotUsername();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* No bot configured: the Profile button is hidden; opened anyway (deep link, stale stack), say so. */}
      {username ? (
        <TelegramSettings username={username} />
      ) : (
        <Text style={styles.muted}>Telegram notifications are not available.</Text>
      )}
    </ScrollView>
  );
}
