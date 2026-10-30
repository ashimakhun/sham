import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Button, Card, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { HomeworkAssignment } from '@/lib/types';

/** "Due …" / "No deadline", and whether the deadline has passed (ARU-32). */
export function dueText(assignment: Pick<HomeworkAssignment, 'dueAt'>) {
  return assignment.dueAt ? `Due ${formatDateTime(assignment.dueAt)}` : 'No deadline';
}
export function isOverdue(assignment: Pick<HomeworkAssignment, 'dueAt'>, now: number) {
  return !!assignment.dueAt && new Date(assignment.dueAt).getTime() <= now;
}

export function OverdueBadge() {
  return (
    <View style={[styles.badge, { backgroundColor: '#FEF2F2' }]}>
      <Text style={[styles.badgeText, { color: colors.danger }]}>Overdue</Text>
    </View>
  );
}

/** A homework assignment the listener hasn't sent homework for yet: the "New" list (ARU-32 AC 6). */
export function AssignmentCard({ item, now }: { item: HomeworkAssignment; now: number }) {
  const { getCourse, meetings } = useStore();
  const meeting = meetings.find((m) => m.id === item.meetingId);
  return (
    <Card>
      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <Text style={[styles.title, { flex: 1 }]} numberOfLines={2}>
          {item.title}
        </Text>
        {isOverdue(item, now) && <OverdueBadge />}
      </View>
      <Text style={[styles.label, { color: colors.primary }]} numberOfLines={2}>
        {getCourse(item.courseId)?.title ?? 'No course'}
      </Text>
      {meeting ? <Text style={styles.muted}>Meeting {formatDateTime(meeting.startsAt)}</Text> : null}
      {item.description ? (
        <Text style={styles.body} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
      <Text style={styles.muted}>{dueText(item)}</Text>
      <Button
        title="Add homework"
        variant="secondary"
        onPress={() => router.push({ pathname: '/homework/new', params: { assignmentId: item.id } })}
      />
    </Card>
  );
}
