import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Card, EmptyState, RoleBadge, styles } from '@/components/ui';
import { meetingAttendance } from '@/lib/attendance';
import { isOpenForAttendance } from '@/lib/meetings';
import { canSeeAttendance, canSeeMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { formatDateTime } from '@/lib/theme';
import type { User } from '@/lib/types';
import { useNow } from '@/lib/useNow';

/** Who attended a meeting (ARU-33), from its start time unless canceled (ARU-45): for the course owner, the teacher and mentors who don't listen to the
 *  course. Every current listener is under Attended or Not marked; it follows live store updates. */
export default function MeetingAttendanceScreen() {
  const { id: courseId, meetingId } = useLocalSearchParams<{ id: string; meetingId: string }>();
  const { currentUser, courseMembers, getCourse, getUser, meetings, attendance, loading, refresh } = useStore();
  const now = useNow();

  const course = getCourse(courseId);
  const meeting = meetings.find((m) => m.id === meetingId && m.courseId === courseId);
  const title = <Stack.Screen options={{ title: 'Attendance' }} />;
  if (!course || !meeting || !canSeeMeetings(currentUser, course, courseMembers)) {
    return (
      <>
        {title}
        <EmptyState title="Meeting not found" />
      </>
    );
  }
  if (!canSeeAttendance(currentUser, course, courseMembers)) {
    return (
      <>
        {title}
        <EmptyState title="Only the course owner, the teacher and mentors can see attendance." />
      </>
    );
  }

  const header = (
    <View style={{ gap: 2 }}>
      <Text style={styles.title}>{meeting.topic}</Text>
      <Text style={styles.muted}>{formatDateTime(meeting.startsAt)}</Text>
    </View>
  );

  if (!isOpenForAttendance(meeting, now)) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {title}
        {header}
        <EmptyState
          title={
            meeting.status === 'canceled'
              ? 'This meeting was canceled.'
              : 'Attendance is available once the meeting has started.'
          }
        />
      </ScrollView>
    );
  }

  const { attended, notMarked, total } = meetingAttendance(meeting.id, course.id, courseMembers, attendance);
  const byName = (ids: string[]) =>
    ids
      .map((id) => getUser(id))
      .filter((u): u is User => !!u)
      .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />}>
      {title}
      {header}
      {total === 0 ? (
        <EmptyState title="This course has no listeners." />
      ) : (
        [
          { heading: 'Attended', people: byName(attended) },
          { heading: 'Not marked', people: byName(notMarked) },
        ]
          .filter((g) => g.people.length > 0)
          .map((g) => (
            <Card key={g.heading} style={{ gap: 10 }}>
              <Text accessibilityRole="header" style={[styles.title, { fontSize: 15 }]}>
                {g.heading}
              </Text>
              {g.people.map((u) => (
                <View key={u.id} style={styles.row}>
                  <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                    {u.name}
                  </Text>
                  <RoleBadge role={u.role} />
                </View>
              ))}
            </Card>
          ))
      )}
    </ScrollView>
  );
}
