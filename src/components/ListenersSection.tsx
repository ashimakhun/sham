import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Card, ErrorText, RoleBadge, styles } from '@/components/ui';
import { confirmDestructive } from '@/lib/confirm';
import { canManageListeners } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** Listeners of a course, with add/remove for teachers and mentors (ARU-7). */
export function ListenersSection({ course }: { course: Course }) {
  const { currentUser, courseMembers, getUser, countListenerHomework, removeListener } = useStore();
  const { busy, error, run } = useAction();
  const [removingId, setRemovingId] = useState<string>();

  const canManage = canManageListeners(currentUser?.role);
  const members = courseMembers.filter((m) => m.courseId === course.id);
  // Students only see listeners of courses they are in (RLS returns no rows for other courses).
  const isListener = members.some((m) => m.userId === currentUser?.id);
  if (!canManage && !isListener) return null;

  const listeners = members
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
      <View style={styles.row}>
        <Text style={styles.label}>LISTENERS ({listeners.length})</Text>
      </View>
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
                disabled={busy}
                hitSlop={8}
                onPress={() => confirmRemove(member.userId, user?.name ?? 'this listener')}>
                <Text style={{ color: colors.danger, fontWeight: '600', opacity: busy ? 0.4 : 1 }}>
                  {removingId === member.userId ? 'Removing…' : 'Remove'}
                </Text>
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
