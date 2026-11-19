import { ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';
import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

/**
 * ARU-162 AC 5: Profile → Blocked people. The people I've blocked, each with Unblock; unblocking shows their content
 * again. A person whose account is gone isn't listed (the database removes the block with the account).
 */
export default function BlockedPeopleScreen() {
  const { blockedUserIds, getUser, unblockUser } = useStore();
  const { t } = useI18n();
  const { busy, error, run } = useAction();

  const people = blockedUserIds
    .map((id) => getUser(id))
    .filter((u) => !!u)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      {people.length === 0 ? (
        <EmptyState title={t('block.none')} />
      ) : (
        <Card style={{ gap: 0 }}>
          {people.map((u, i) => (
            <View
              key={u.id}
              testID={`blocked-${u.id}`}
              style={[styles.row, { paddingVertical: 8, gap: 12 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <Text style={[styles.body, { flex: 1 }]}>{u.name}</Text>
              <Button
                title={t('block.unblock')}
                variant="secondary"
                disabled={busy}
                onPress={() => run(() => unblockUser(u.id))}
              />
            </View>
          ))}
        </Card>
      )}
      <ErrorText error={error} />
    </ScrollView>
  );
}
