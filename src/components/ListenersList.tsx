import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Button, Card, ErrorText, RoleBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { confirmDestructive } from '@/lib/confirm';
import { canManageListeners } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Course, CourseMember, User } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** Teachers and mentors, or a listener of the course, can see its listeners (ARU-7; RLS enforces it too). */
export function canSeeListeners(user: User | null | undefined, courseId: string, courseMembers: CourseMember[]) {
  if (!user) return false;
  return canManageListeners(user.role) || courseMembers.some((m) => m.courseId === courseId && m.userId === user.id);
}

/** ARU-97: the listeners of a course, with X to remove and "+ Add listeners" for teachers and mentors. */
export function ListenersList({ course }: { course: Course }) {
  const { currentUser, courseMembers, getUser, countListenerHomework, removeListener } = useStore();
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [removingId, setRemovingId] = useState<string>();

  const canManage = canManageListeners(currentUser?.role);
  const listeners = courseMembers
    .filter((m) => m.courseId === course.id)
    .map((m) => ({ member: m, user: getUser(m.userId) }))
    .sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? ''));

  function confirmRemove(userId: string, name: string) {
    run(async () => {
      setRemovingId(userId);
      try {
        const n = await countListenerHomework(course.id, userId);
        // ARU-109: one sentence per case, so the Russian homework count agrees with its verb.
        const message =
          n > 0
            ? t('listeners.removeWithHomework', { name, title: course.title, count: n })
            : t('listeners.removeMessage', { name, title: course.title });
        const confirmed = await confirmDestructive(t('listeners.removeTitle'), message, t('listeners.remove'));
        if (confirmed) await removeListener(course.id, userId);
      } finally {
        setRemovingId(undefined);
      }
    });
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.label}>{t('listeners.heading', { n: listeners.length })}</Text>
      {listeners.length === 0 ? (
        <Text style={styles.muted}>{t('listeners.none')}</Text>
      ) : (
        listeners.map(({ member, user }) => (
          <View key={member.userId} style={[styles.row, { alignItems: 'flex-start' }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.body} numberOfLines={2}>
                {user?.name ?? t('listeners.unknownUser')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {user && <RoleBadge role={user.role} />}
                <Text style={styles.muted}>{t('listeners.added', { date: formatDate(member.addedAt) })}</Text>
              </View>
            </View>
            {canManage && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={user ? t('listeners.removeA11y', { name: user.name }) : t('listeners.removeThisA11y')}
                accessibilityState={{ disabled: busy, busy: removingId === member.userId }}
                disabled={busy}
                hitSlop={10}
                testID={`remove-listener-${member.userId}`}
                style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => confirmRemove(member.userId, user?.name ?? t('listeners.thisListener'))}>
                {removingId === member.userId ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Ionicons name="close" size={22} color={colors.danger} style={{ opacity: busy ? 0.4 : 1 }} />
                )}
              </Pressable>
            )}
          </View>
        ))
      )}
      <ErrorText error={error} />
      {canManage && (
        <Button
          title={t('listeners.addMore')}
          variant="secondary"
          onPress={() => router.push({ pathname: '/courses/[id]/listeners', params: { id: course.id } })}
        />
      )}
    </Card>
  );
}
