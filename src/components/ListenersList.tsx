import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Button, Card, ErrorText, RoleBadge, styles } from '@/components/ui';
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
        const message =
          `Remove ${name} from ${course.title}?` + (n > 0 ? ` Their ${n} homework for this course will be deleted.` : '');
        const confirmed = await confirmDestructive('Remove listener', message, 'Remove');
        if (confirmed) await removeListener(course.id, userId);
      } finally {
        setRemovingId(undefined);
      }
    });
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.label}>LISTENERS ({listeners.length})</Text>
      {listeners.length === 0 ? (
        <Text style={styles.muted}>No listeners yet</Text>
      ) : (
        listeners.map(({ member, user }) => (
          <View key={member.userId} style={[styles.row, { alignItems: 'flex-start' }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.body} numberOfLines={2}>
                {user?.name ?? 'Unknown user'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {user && <RoleBadge role={user.role} />}
                <Text style={styles.muted}>Added {formatDate(member.addedAt)}</Text>
              </View>
            </View>
            {canManage && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={user ? `Remove ${user.name}` : 'Remove this listener'}
                accessibilityState={{ disabled: busy, busy: removingId === member.userId }}
                disabled={busy}
                hitSlop={10}
                testID={`remove-listener-${member.userId}`}
                style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => confirmRemove(member.userId, user?.name ?? 'this listener')}>
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
          title="+ Add listeners"
          variant="secondary"
          onPress={() => router.push({ pathname: '/courses/[id]/listeners', params: { id: course.id } })}
        />
      )}
    </Card>
  );
}
