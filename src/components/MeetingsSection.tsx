import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Button, Card, ErrorText, styles } from '@/components/ui';
import { meetingAttendance } from '@/lib/attendance';
import { confirmAction } from '@/lib/confirm';
import { DELETED_ACCOUNT } from '@/lib/deleteAccount';
import {
  groupMeetings,
  hasStarted,
  isLink,
  isOpenForAttendance,
  meetingAccent,
  meetingBadge,
  type MeetingGroup,
} from '@/lib/meetings';
import {
  canCheckMeetingHomework,
  canManageMeetings,
  canMarkAttendance,
  canSeeAttendance,
  canSeeMeetings,
} from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDate, formatDateTime } from '@/lib/theme';
import type { Course, Meeting, MeetingStatus } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useNow } from '@/lib/useNow';
import { font } from '@/lib/fonts';

/** ARU-88: the meeting's display state; a started Scheduled meeting reads "In progress" (see `meetingBadge`). Read
 *  by screen readers as plain text. */
export function MeetingBadge({ meeting, now }: { meeting: Pick<Meeting, 'status' | 'startsAt'>; now: number }) {
  const { label, bg, fg } = meetingBadge(meeting, now);
  return (
    <View testID="status-badge" style={[styles.badge, { backgroundColor: bg, flexShrink: 0 }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** Pills are about 30 pt tall; the vertical hit slop makes the tap target at least 44 pt (ARU-88 AC 6). */
const PILL_HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 };

/** ARU-88: a compact action pill in a meeting tile's footer. Red (`danger`) for Mark canceled / Cancel meeting and
 *  attendance Undo. `disabled` is passed only by actions that were disabled while saving before. */
function ActionPill({
  title,
  label = title,
  role = 'button',
  tone = 'primary',
  disabled,
  onPress,
}: {
  title: string;
  label?: string;
  role?: 'button' | 'link';
  tone?: 'primary' | 'danger';
  disabled?: boolean;
  onPress: () => void;
}) {
  const danger = tone === 'danger';
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={disabled === undefined ? undefined : { disabled }}
      disabled={disabled}
      hitSlop={PILL_HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [tile.pill, danger && tile.pillDanger, pressed && { opacity: 0.7 }]}>
      <Text style={[tile.pillText, { color: danger ? colors.danger : colors.primary, opacity: disabled ? 0.4 : 1 }]}>
        {title}
      </Text>
    </Pressable>
  );
}

type Target = Exclude<MeetingStatus, 'scheduled'>;

/** Meetings of a course (ARU-10): visible to the teacher, mentors and the course's listeners; the owner and the
 *  teacher schedule meetings and mark them completed or canceled.
 *  ARU-60: `part="current"` is the MEETINGS card under Chat (In progress, Upcoming, Awaiting homework check);
 *  `part="history"` is MEETING HISTORY at the bottom of the page (checked and canceled meetings), hidden when empty.
 *  Each part has its own error text. */
export function MeetingsSection({ course, part = 'current' }: { course: Course; part?: 'current' | 'history' }) {
  const {
    currentUser,
    courseMembers,
    meetings,
    assignments,
    attendance,
    getUser,
    setMeetingStatus,
    setMeetingHomeworkChecked,
    markAttendance,
    unmarkAttendance,
  } = useStore();
  const { busy, error, run } = useAction();
  const [changing, setChanging] = useState<string>();
  const now = useNow();

  if (!canSeeMeetings(currentUser, course, courseMembers)) return null;
  const canManage = canManageMeetings(currentUser, course);
  const seesAttendance = canSeeAttendance(currentUser, course, courseMembers);
  const canCheck = canCheckMeetingHomework(currentUser, course, courseMembers);
  const { inProgress, upcoming, awaitingCheck, history } = groupMeetings(
    meetings.filter((m) => m.courseId === course.id),
    now,
  );
  const current = [...inProgress, ...upcoming, ...awaitingCheck];
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

  // ARU-60: mark a Completed meeting's homework checked (moves it to MEETING HISTORY), or undo that.
  function setChecked(meeting: Meeting, checked: boolean) {
    run(async () => {
      const when = formatDateTime(meeting.startsAt);
      const confirmed = await confirmAction(
        checked ? 'Mark homework checked' : 'Undo check',
        checked
          ? `Mark homework for ${meeting.topic} on ${when} as checked?`
          : `Move ${meeting.topic} on ${when} back to Awaiting homework check?`,
        checked ? 'Mark checked' : 'Undo check',
        { cancelText: 'Not now' },
      );
      if (!confirmed) return;
      setChanging(meeting.id);
      try {
        await setMeetingHomeworkChecked(meeting.id, checked);
      } finally {
        setChanging(undefined);
      }
    });
  }

  // Attendance (ARU-33): a listener marks or undoes their own attendance once a meeting has started (ARU-45).
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

  if (part === 'history') {
    if (history.length === 0) return null;
    return (
      <View testID="meeting-history" style={{ paddingTop: 12 }}>
        <Card style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={styles.label}>
            MEETING HISTORY ({history.length})
          </Text>
          <View style={tile.list}>{history.map((m) => renderMeeting(m, 'history'))}</View>
          <ErrorText error={error} />
        </Card>
      </View>
    );
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.label}>MEETINGS ({current.length})</Text>
      {current.length === 0 ? (
        <Text style={styles.muted}>{history.length > 0 ? 'No current meetings' : 'No meetings scheduled yet'}</Text>
      ) : (
        (
          [
            { group: 'inProgress', heading: 'In progress', items: inProgress },
            { group: 'upcoming', heading: 'Upcoming', items: upcoming },
            { group: 'awaitingCheck', heading: 'Awaiting homework check', items: awaitingCheck },
          ] as const
        )
          .filter((g) => g.items.length > 0)
          .map((g) => (
            // ARU-88 AC 5: small uppercase muted headings with the group's count, and 8 pt more space above each
            // group than between tiles, so a heading can't be mistaken for a meeting.
            <View key={g.group} style={[tile.list, { marginTop: 8 }]}>
              <Text accessibilityRole="header" style={styles.label}>
                {`${g.heading.toUpperCase()} (${g.items.length})`}
              </Text>
              {g.items.map((m) => renderMeeting(m, g.group))}
            </View>
          ))
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

  function renderMeeting(m: Meeting, group: MeetingGroup) {
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
    // From the start time until the meeting is canceled (ARU-45); `now` ticks, so it appears without a refresh.
    const canMark = canMarkAttendance(currentUser, course, courseMembers, m, now);
    const attended = canMark && attendance.some((a) => a.meetingId === m.id && a.userId === currentUser?.id);
    // ARU-60: completed meetings only; the line shows who marked it once it's in MEETING HISTORY.
    const checkAction =
      canCheck && m.status === 'completed'
        ? m.homeworkCheckedAt
          ? { title: 'Undo check', checked: false }
          : { title: 'Mark homework checked', checked: true }
        : null;
    const checkedLine =
      m.status === 'completed' && m.homeworkCheckedAt
        ? // ARU-75: no checker any more means they deleted their account.
          `Homework checked by ${m.homeworkCheckedById ? getUser(m.homeworkCheckedById)?.name || 'Unknown' : DELETED_ACCOUNT} · ${formatDate(m.homeworkCheckedAt)}`
        : null;
    const counts =
      seesAttendance && isOpenForAttendance(m, now)
        ? meetingAttendance(m.id, course.id, courseMembers, attendance)
        : null;

    // ARU-88 AC 6: the footer's pills, in the order they had before; the red ones (attendance Undo, Mark canceled /
    // Cancel meeting) always come last.
    const footer = [
      ...(canEdit
        ? [
            <ActionPill
              key="edit"
              title="Edit"
              disabled={busy}
              onPress={() =>
                router.push({ pathname: '/courses/[id]/meetings/[meetingId]', params: { id: course.id, meetingId: m.id } })
              }
            />,
          ]
        : []),
      ...notesActions.map((a) => (
        <ActionPill key={a.title} title={a.title} role={a.edit ? 'button' : 'link'} onPress={() => openNotes(m, a.edit)} />
      )),
      ...(canAssign
        ? [
            <ActionPill
              key="assign"
              title="Assign homework"
              onPress={() =>
                router.push({
                  pathname: '/courses/[id]/meetings/[meetingId]/assign-homework',
                  params: { id: course.id, meetingId: m.id },
                })
              }
            />,
          ]
        : []),
      ...(canMark && !attended
        ? [<ActionPill key="attend" title="I attended" disabled={busy} onPress={() => markAttended(m)} />]
        : []),
      // ARU-88 AC 7: a status chip, not a button, so it doesn't look tappable.
      ...(attended
        ? [
            <View key="attended" style={[tile.pill, { backgroundColor: colors.successSoft }]}>
              <Text style={[tile.pillText, { color: colors.success }]}>✓ You attended</Text>
            </View>,
          ]
        : []),
      ...(counts
        ? [
            <ActionPill
              key="count"
              role="link"
              title={`Attended: ${counts.attended.length} of ${counts.total}`}
              label={`Attended ${counts.attended.length} of ${counts.total}`}
              onPress={() =>
                router.push({
                  pathname: '/courses/[id]/meetings/[meetingId]/attendance',
                  params: { id: course.id, meetingId: m.id },
                })
              }
            />,
          ]
        : []),
      ...(checkAction
        ? [
            <ActionPill
              key="check"
              title={checkAction.title}
              disabled={busy}
              onPress={() => setChecked(m, checkAction.checked)}
            />,
          ]
        : []),
      ...actions
        .filter((a) => a.status === 'completed')
        .map((a) => <ActionPill key={a.title} title={a.title} disabled={busy} onPress={() => changeStatus(m, a.status)} />),
      ...(attended
        ? [
            <ActionPill
              key="undo"
              title="Undo"
              label="Undo attendance"
              tone="danger"
              disabled={busy}
              onPress={() => undoAttended(m)}
            />,
          ]
        : []),
      ...actions
        .filter((a) => a.status === 'canceled')
        .map((a) => (
          <ActionPill key={a.title} title={a.title} tone="danger" disabled={busy} onPress={() => changeStatus(m, a.status)} />
        )),
    ];

    // ARU-88 AC 1/2: its own tile, with a left bar in the group's colour. Not `accessible` as a whole, so screen
    // readers still reach each action (ARU-27).
    return (
      <View key={m.id} testID={`meeting-${m.id}`} style={[tile.tile, { borderLeftColor: meetingAccent[group] }]}>
        {/* AC 4: the topic first, with the badge on the right that never gets squeezed off. */}
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <Text style={tile.topic} numberOfLines={2}>
            {m.topic}
          </Text>
          <MeetingBadge meeting={m} now={now} />
        </View>
        <Text style={styles.muted}>
          {formatDateTime(m.startsAt)}
          {m.rescheduledAt ? <Text style={styles.muted}>{'  '}Rescheduled</Text> : null}
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
            <Text style={{ ...font(500), color: colors.text }}>Homework: {assignment.title}</Text>
            {' · '}
            {assignment.dueAt ? `Due ${formatDateTime(assignment.dueAt)}` : 'No deadline'}
          </Text>
        ) : null}
        {checkedLine ? (
          <Text style={styles.muted} testID={`checked-${m.id}`}>
            {checkedLine}
          </Text>
        ) : null}
        {/* AC 6: no divider and no footer when the meeting has no actions. "Saving…" replaces the footer. */}
        {footer.length > 0 && (
          <View testID={`actions-${m.id}`} style={tile.footer}>
            {changing === m.id ? <Text style={styles.muted}>Saving…</Text> : footer}
          </View>
        )}
      </View>
    );
  }
}

const tile = StyleSheet.create({
  list: { gap: 10 },
  // AC 1: rounded, light background, 1 pt outline; AC 2: a 4 pt left bar (its colour is set per tile).
  tile: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: 12,
    gap: 4,
  },
  topic: { flex: 1, fontSize: 16, ...font(600), color: colors.text },
  // AC 6: a thin divider above the actions, which wrap in rows with 8 pt gaps.
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pill: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  pillDanger: { backgroundColor: '#FEF2F2' },
  pillText: { fontSize: 13, ...font(500) },
});
