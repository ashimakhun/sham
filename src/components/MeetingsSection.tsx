import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { Button, Card, ErrorText, styles } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { hasStarted, isLink, sortMeetings } from '@/lib/meetings';
import { canManageMeetings, canSeeMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { Course, Meeting, MeetingStatus } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useNow } from '@/lib/useNow';

const statusLabel: Record<MeetingStatus, string> = { scheduled: 'Scheduled', completed: 'Completed', canceled: 'Canceled' };
const statusColors: Record<MeetingStatus, { bg: string; fg: string }> = {
  scheduled: { bg: colors.primarySoft, fg: colors.primary },
  completed: { bg: colors.successSoft, fg: colors.success },
  canceled: { bg: '#F3F4F6', fg: colors.muted },
};

export function MeetingBadge({ status }: { status: MeetingStatus }) {
  return (
    <View style={[styles.badge, { backgroundColor: statusColors[status].bg }]}>
      <Text style={[styles.badgeText, { color: statusColors[status].fg }]}>{statusLabel[status]}</Text>
    </View>
  );
}

type Target = Exclude<MeetingStatus, 'scheduled'>;

/** Meetings of a course (ARU-10): visible to the teacher, mentors and the course's listeners; the owner and the
 *  teacher schedule meetings and mark them completed or canceled. */
export function MeetingsSection({ course }: { course: Course }) {
  const { currentUser, courseMembers, meetings, setMeetingStatus } = useStore();
  const { busy, error, run } = useAction();
  const [changing, setChanging] = useState<string>();
  const now = useNow();

  if (!canSeeMeetings(currentUser, course, courseMembers)) return null;
  const canManage = canManageMeetings(currentUser, course);
  const { upcoming, past } = sortMeetings(
    meetings.filter((m) => m.courseId === course.id),
    now,
  );
  const list = [...upcoming, ...past];

  function changeStatus(meeting: Meeting, status: Target) {
    const verb = status === 'completed' ? 'completed' : 'canceled';
    run(async () => {
      const confirmed = await confirmAction(
        status === 'completed' ? 'Mark completed' : 'Cancel meeting',
        `Mark ${meeting.topic} on ${formatDateTime(meeting.startsAt)} as ${verb}?`,
        `Mark ${verb}`,
        { destructive: status === 'canceled', cancelText: 'Not now' },
      );
      if (!confirmed) return;
      setChanging(meeting.id);
      try {
        await setMeetingStatus(meeting.id, status);
      } finally {
        setChanging(undefined);
      }
    });
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.label}>MEETINGS ({list.length})</Text>
      {list.length === 0 ? (
        <Text style={styles.muted}>No meetings scheduled yet</Text>
      ) : (
        list.map((m) => {
          const started = hasStarted(m, now);
          const actions: { title: string; status: Target }[] =
            !canManage || m.status !== 'scheduled'
              ? []
              : started
                ? [
                    { title: 'Mark completed', status: 'completed' },
                    { title: 'Mark canceled', status: 'canceled' },
                  ]
                : [{ title: 'Cancel meeting', status: 'canceled' }];
          return (
            <View key={m.id} testID={`meeting-${m.id}`} style={{ gap: 4 }}>
              <View style={[styles.row, { alignItems: 'flex-start' }]}>
                <Text style={[styles.body, { flex: 1, fontWeight: '600' }]}>{formatDateTime(m.startsAt)}</Text>
                <MeetingBadge status={m.status} />
              </View>
              <Text style={styles.body} numberOfLines={2}>
                {m.topic}
              </Text>
              {m.location ? (
                isLink(m.location) ? (
                  <Text
                    accessibilityRole="link"
                    numberOfLines={2}
                    style={[styles.body, { color: colors.primary, textDecorationLine: 'underline' }]}
                    onPress={() => Linking.openURL(m.location!.trim()).catch(() => {})}>
                    {m.location}
                  </Text>
                ) : (
                  <Text style={styles.muted} numberOfLines={2}>
                    {m.location}
                  </Text>
                )
              ) : null}
              {actions.length > 0 && (
                <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap', paddingTop: 2 }}>
                  {changing === m.id ? (
                    <Text style={styles.muted}>Saving…</Text>
                  ) : (
                    actions.map((a) => (
                      <Pressable
                        key={a.title}
                        accessibilityRole="button"
                        accessibilityLabel={a.title}
                        accessibilityState={{ disabled: busy }}
                        disabled={busy}
                        hitSlop={8}
                        onPress={() => changeStatus(m, a.status)}>
                        <Text
                          style={{
                            color: a.status === 'canceled' ? colors.danger : colors.primary,
                            fontWeight: '600',
                            opacity: busy ? 0.4 : 1,
                          }}>
                          {a.title}
                        </Text>
                      </Pressable>
                    ))
                  )}
                </View>
              )}
            </View>
          );
        })
      )}
      <ErrorText error={error} />
      {canManage && (
        <Button
          title="+ Schedule meeting"
          variant="secondary"
          onPress={() => router.push({ pathname: '/courses/[id]/meetings/new', params: { id: course.id } })}
        />
      )}
    </Card>
  );
}
