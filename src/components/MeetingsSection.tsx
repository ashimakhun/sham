import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { Button, Card, ErrorText, styles } from '@/components/ui';
import { meetingAttendance } from '@/lib/attendance';
import { confirmAction } from '@/lib/confirm';
import { hasStarted, isLink, sortMeetings } from '@/lib/meetings';
import { canManageMeetings, canMarkAttendance, canSeeAttendance, canSeeMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { Course, Meeting, MeetingStatus } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useNow } from '@/lib/useNow';

const statusLabel: Record<MeetingStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  canceled: 'Canceled',
};
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
  const {
    currentUser,
    courseMembers,
    meetings,
    assignments,
    attendance,
    setMeetingStatus,
    markAttendance,
    unmarkAttendance,
  } = useStore();
  const { busy, error, run } = useAction();
  const [changing, setChanging] = useState<string>();
  const now = useNow();

  if (!canSeeMeetings(currentUser, course, courseMembers)) return null;
  const canManage = canManageMeetings(currentUser, course);
  const seesAttendance = canSeeAttendance(currentUser, course, courseMembers);
  const { upcoming, past } = sortMeetings(
    meetings.filter((m) => m.courseId === course.id),
    now,
  );
  const list = [...upcoming, ...past];
  const openNotes = (m: Meeting, edit: boolean) =>
    router.push({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params: edit ? { id: course.id, meetingId: m.id, edit: '1' } : { id: course.id, meetingId: m.id },
    });

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

  // Attendance (ARU-33): a listener marks or undoes their own attendance of a Completed meeting.
  function markAttended(meeting: Meeting) {
    run(async () => {
      setChanging(meeting.id);
      try {
        await markAttendance(meeting.id);
      } finally {
        setChanging(undefined);
      }
    });
  }

  function undoAttended(meeting: Meeting) {
    run(async () => {
      const confirmed = await confirmAction(
        'Undo attendance',
        `Remove your attendance for ${meeting.topic} on ${formatDateTime(meeting.startsAt)}?`,
        'Remove',
        { destructive: true, cancelText: 'Not now' },
      );
      if (!confirmed) return;
      setChanging(meeting.id);
      try {
        await unmarkAttendance(meeting.id);
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
        [
          upcoming.length > 0 && { heading: 'Upcoming', items: upcoming },
          past.length > 0 && { heading: 'History', items: past },
        ].map(
          (group) =>
            group && (
              <View key={group.heading} style={{ gap: 12 }}>
                <Text accessibilityRole="header" style={[styles.title, { fontSize: 15 }]}>
                  {group.heading}
                </Text>
                {group.items.map((m) => renderMeeting(m))}
              </View>
            ),
        )
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

  function renderMeeting(m: Meeting) {
    const started = hasStarted(m, now);
    const canEdit = canManage && m.status === 'scheduled';
    const actions: { title: string; status: Target }[] =
      !canManage || m.status !== 'scheduled'
        ? []
        : started
          ? [
              { title: 'Mark completed', status: 'completed' },
              { title: 'Mark canceled', status: 'canceled' },
            ]
          : [{ title: 'Cancel meeting', status: 'canceled' }];
    // Notes (ARU-28): everyone who sees a completed meeting reads them; the owner and the teacher add or edit.
    const notesActions: { title: string; edit: boolean }[] =
      m.status !== 'completed'
        ? []
        : [
            ...(m.notes ? [{ title: 'Notes', edit: false }] : []),
            ...(canManage ? [{ title: m.notes ? 'Edit notes' : 'Add notes', edit: true }] : []),
          ];
    // Homework (ARU-32): one assignment per completed meeting, shown to everyone who sees the meeting.
    const assignment = assignments.find((a) => a.meetingId === m.id);
    const canAssign = canManage && m.status === 'completed' && !assignment;
    // Attendance (ARU-33): listeners mark their own; the owner, the teacher and non-listener mentors see the count.
    const canMark = canMarkAttendance(currentUser, course, courseMembers, m);
    const attended = canMark && attendance.some((a) => a.meetingId === m.id && a.userId === currentUser?.id);
    const counts =
      seesAttendance && m.status === 'completed' ? meetingAttendance(m.id, course.id, courseMembers, attendance) : null;
    const attendanceItems = [
      ...(canMark && !attended
        ? [
            <Pressable
              key="attend"
              accessibilityRole="button"
              accessibilityLabel="I attended"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={8}
              onPress={() => markAttended(m)}>
              <Text style={{ color: colors.primary, fontWeight: '600', opacity: busy ? 0.4 : 1 }}>I attended</Text>
            </Pressable>,
          ]
        : []),
      ...(attended
        ? [
            <Text key="attended" style={{ color: colors.success, fontWeight: '600' }}>
              ✓ You attended
            </Text>,
            <Pressable
              key="undo"
              accessibilityRole="button"
              accessibilityLabel="Undo attendance"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={8}
              onPress={() => undoAttended(m)}>
              <Text style={{ color: colors.primary, fontWeight: '600', opacity: busy ? 0.4 : 1 }}>Undo</Text>
            </Pressable>,
          ]
        : []),
      ...(counts
        ? [
            <Pressable
              key="count"
              accessibilityRole="link"
              accessibilityLabel={`Attended ${counts.attended.length} of ${counts.total}`}
              hitSlop={8}
              onPress={() =>
                router.push({
                  pathname: '/courses/[id]/meetings/[meetingId]/attendance',
                  params: { id: course.id, meetingId: m.id },
                })
              }>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>
                Attended: {counts.attended.length} of {counts.total}
              </Text>
            </Pressable>,
          ]
        : []),
    ];
    return (
      <View key={m.id} testID={`meeting-${m.id}`} style={{ gap: 4 }}>
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <Text style={[styles.body, { flex: 1, fontWeight: '600' }]}>
            {formatDateTime(m.startsAt)}
            {m.rescheduledAt ? <Text style={styles.muted}>{'  '}Rescheduled</Text> : null}
          </Text>
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
        {assignment ? (
          <Text style={styles.muted} numberOfLines={2} testID={`assignment-${m.id}`}>
            <Text style={{ fontWeight: '600', color: colors.text }}>Homework: {assignment.title}</Text>
            {' · '}
            {assignment.dueAt ? `Due ${formatDateTime(assignment.dueAt)}` : 'No deadline'}
          </Text>
        ) : null}
        {(actions.length > 0 || canEdit || notesActions.length > 0 || canAssign || attendanceItems.length > 0) && (
          <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap', paddingTop: 2 }}>
            {changing === m.id ? (
              <Text style={styles.muted}>Saving…</Text>
            ) : (
              [
                ...(canEdit
                  ? [
                      <Pressable
                        key="edit"
                        accessibilityRole="button"
                        accessibilityLabel="Edit"
                        accessibilityState={{ disabled: busy }}
                        disabled={busy}
                        hitSlop={8}
                        onPress={() =>
                          router.push({
                            pathname: '/courses/[id]/meetings/[meetingId]',
                            params: { id: course.id, meetingId: m.id },
                          })
                        }>
                        <Text style={{ color: colors.primary, fontWeight: '600', opacity: busy ? 0.4 : 1 }}>Edit</Text>
                      </Pressable>,
                    ]
                  : []),
                ...notesActions.map((a) => (
                  <Pressable
                    key={a.title}
                    accessibilityRole={a.edit ? 'button' : 'link'}
                    accessibilityLabel={a.title}
                    hitSlop={8}
                    onPress={() => openNotes(m, a.edit)}>
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>{a.title}</Text>
                  </Pressable>
                )),
                ...(canAssign
                  ? [
                      <Pressable
                        key="assign"
                        accessibilityRole="button"
                        accessibilityLabel="Assign homework"
                        hitSlop={8}
                        onPress={() =>
                          router.push({
                            pathname: '/courses/[id]/meetings/[meetingId]/assign-homework',
                            params: { id: course.id, meetingId: m.id },
                          })
                        }>
                        <Text style={{ color: colors.primary, fontWeight: '600' }}>Assign homework</Text>
                      </Pressable>,
                    ]
                  : []),
                ...attendanceItems,
                ...actions.map((a) => (
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
                )),
              ]
            )}
          </View>
        )}
      </View>
    );
  }
}
