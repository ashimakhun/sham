import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Button, Card, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import type { TextId } from '@/i18n';
import { meetingAttendance } from '@/lib/attendance';
import { confirmAction } from '@/lib/confirm';
import {
  type MeetingBadgeInfo,
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
  canWriteListenerNotes,
} from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { Course, Meeting, MeetingStatus } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useNow } from '@/lib/useNow';
import { font } from '@/lib/fonts';

/** ARU-109: `meetingBadge` gives the English label; the badge shows the catalog text for it. */
const BADGE_TEXT: Record<MeetingBadgeInfo['label'], TextId> = {
  'In progress': 'meetings.badgeInProgress',
  Scheduled: 'meetings.badgeScheduled',
  Completed: 'meetings.badgeCompleted',
  Canceled: 'meetings.badgeCanceled',
};

/** ARU-88: the meeting's display state; a started Scheduled meeting reads "In progress" (see `meetingBadge`). Read
 *  by screen readers as plain text. */
export function MeetingBadge({ meeting, now }: { meeting: Pick<Meeting, 'status' | 'startsAt'>; now: number }) {
  const { t } = useI18n();
  const { label, bg, fg } = meetingBadge(meeting, now);
  return (
    <View testID="status-badge" style={[styles.badge, { backgroundColor: bg, flexShrink: 0 }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{t(BADGE_TEXT[label])}</Text>
    </View>
  );
}

/** Pills are about 30 pt tall; the vertical hit slop makes the tap target at least 44 pt (ARU-88 AC 6). */
const PILL_HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 };

/** ARU-126: a round icon-only pill is 30 pt across; this slop makes its tap target 44 × 44 pt. */
const ICON_HIT_SLOP = { top: 7, bottom: 7, left: 7, right: 7 };

const TONE = {
  primary: { fg: colors.primary, bg: colors.primarySoft },
  success: { fg: colors.success, bg: colors.successSoft },
  danger: { fg: colors.danger, bg: '#FEF2F2' },
} as const;

/** ARU-88: a compact action pill in a meeting tile's footer. Red (`danger`) for Cancel meeting and attendance Undo.
 *  `disabled` is passed only by actions that were disabled while saving before.
 *  ARU-126: with an `icon` and no `title` it's a round icon-only pill (✓, ✕, pencil); with both, the icon comes before
 *  the text (the people count). `label` is what screen readers say. */
function ActionPill({
  title,
  label = title,
  icon,
  role = 'button',
  tone = 'primary',
  disabled,
  onPress,
  testID,
}: {
  title?: string;
  label?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  role?: 'button' | 'link';
  tone?: keyof typeof TONE;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { fg, bg } = TONE[tone];
  const round = !!icon && !title;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={disabled === undefined ? undefined : { disabled }}
      disabled={disabled}
      hitSlop={round ? ICON_HIT_SLOP : PILL_HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [
        tile.pill,
        { backgroundColor: bg },
        round && tile.iconPill,
        !!icon && !!title && tile.iconTextPill,
        pressed && { opacity: 0.7 },
      ]}>
      {icon ? <Ionicons name={icon} size={round ? 18 : 15} color={fg} style={{ opacity: disabled ? 0.4 : 1 }} /> : null}
      {title ? <Text style={[tile.pillText, { color: fg, opacity: disabled ? 0.4 : 1 }]}>{title}</Text> : null}
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
    meetingListenerNotes,
    setMeetingStatus,
    setMeetingHomeworkChecked,
    markAttendance,
    unmarkAttendance,
  } = useStore();
  const { busy, error, run } = useAction();
  const { t } = useI18n();
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
  // ARU-125: `mine` opens a listener's editor for their own notes.
  const openNotes = (m: Meeting, mode: 'view' | 'edit' | 'mine') =>
    router.push({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params:
        mode === 'edit'
          ? { id: course.id, meetingId: m.id, edit: '1' }
          : mode === 'mine'
            ? { id: course.id, meetingId: m.id, mine: '1' }
            : { id: course.id, meetingId: m.id },
    });

  function changeStatus(meeting: Meeting, status: Target) {
    const completed = status === 'completed';
    run(async () => {
      const values = { when: formatDateTime(meeting.startsAt) };
      const confirmed = await confirmAction(
        t(completed ? 'meetings.markCompleted' : 'meetings.cancelMeeting'),
        t(completed ? 'meetings.confirmCompleted' : 'meetings.confirmCanceled', values),
        t(completed ? 'meetings.markCompleted' : 'meetings.markCanceled'),
        { destructive: status === 'canceled', cancelText: t('meetings.notNow') },
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

  // ARU-60: mark a Completed meeting's homework checked (moves it to MEETING HISTORY). ARU-126 AC 8: there is no
  // undo in the app any more, which is why the confirmation stays.
  function markChecked(meeting: Meeting) {
    run(async () => {
      const values = { when: formatDateTime(meeting.startsAt) };
      const confirmed = await confirmAction(
        t('meetings.markHomeworkChecked'),
        t('meetings.confirmChecked', values),
        t('meetings.markChecked'),
        { cancelText: t('meetings.notNow') },
      );
      if (!confirmed) return;
      setChanging(meeting.id);
      try {
        await setMeetingHomeworkChecked(meeting.id, true);
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
        t('meetings.undoAttendance'),
        t('meetings.confirmUndoAttendance', { when: formatDateTime(meeting.startsAt) }),
        t('meetings.remove'),
        { destructive: true, cancelText: t('meetings.notNow') },
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
            {t('meetings.historyHeading', { n: history.length })}
          </Text>
          <View style={tile.list}>{history.map((m) => renderMeeting(m, 'history'))}</View>
          <ErrorText error={error} />
        </Card>
      </View>
    );
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.label}>{t('meetings.heading', { n: current.length })}</Text>
      {current.length === 0 ? (
        <Text style={styles.muted}>{t(history.length > 0 ? 'meetings.noCurrent' : 'meetings.noneYet')}</Text>
      ) : (
        (
          [
            { group: 'inProgress', heading: t('meetings.groupInProgress'), items: inProgress },
            { group: 'upcoming', heading: t('meetings.groupUpcoming'), items: upcoming },
            { group: 'awaitingCheck', heading: t('meetings.groupAwaitingCheck'), items: awaitingCheck },
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
          title={t('meetings.scheduleButton')}
          variant="secondary"
          onPress={() => router.push({ pathname: '/courses/[id]/meetings/new', params: { id: course.id } })}
        />
      )}
    </Card>
  );

  function renderMeeting(m: Meeting, group: MeetingGroup) {
    const started = hasStarted(m, now);
    const canEdit = canManage && m.status === 'scheduled';
    // ARU-126 AC 9 / 10: Mark completed (once started) is a ✓ icon; Cancel meeting / Mark canceled one ✕ icon.
    const actions: { label: string; status: Target }[] =
      !canManage || m.status !== 'scheduled'
        ? []
        : started
          ? [
              { label: t('meetings.markCompleted'), status: 'completed' },
              { label: t('meetings.cancelMeeting'), status: 'canceled' },
            ]
          : [{ label: t('meetings.cancelMeeting'), status: 'canceled' }];
    // Notes (ARU-28): everyone who sees a completed meeting reads them; the owner and the teacher add or edit.
    // ARU-125: Notes also shows when a listener added theirs; a current listener adds or edits their own.
    const listenerNotes = (meetingListenerNotes ?? []).filter((n) => n.meetingId === m.id);
    const hasMine = !!currentUser && listenerNotes.some((n) => n.authorId === currentUser.id);
    const notesActions: { title: string; mode: 'view' | 'edit' | 'mine' }[] =
      m.status !== 'completed'
        ? []
        : [
            ...(m.notes || listenerNotes.length > 0 ? [{ title: t('notes.title'), mode: 'view' as const }] : []),
            // ARU-126 AC 5: the owner and the teacher get a pencil right after Notes (or alone without notes).
            ...(canManage ? [{ title: t(m.notes ? 'notes.edit' : 'notes.add'), mode: 'edit' as const }] : []),
            ...(canWriteListenerNotes(currentUser, course, courseMembers, m)
              ? [{ title: t(hasMine ? 'notes.editMine' : 'notes.addMine'), mode: 'mine' as const }]
              : []),
          ];
    // Homework (ARU-32): one assignment per completed meeting, shown to everyone who sees the meeting.
    const assignment = assignments.find((a) => a.meetingId === m.id);
    const canAssign = canManage && m.status === 'completed' && !assignment;
    // Attendance (ARU-33): listeners mark their own; the owner, the teacher and non-listener mentors see the count.
    // From the start time until the meeting is canceled (ARU-45); `now` ticks, so it appears without a refresh.
    const canMark = canMarkAttendance(currentUser, course, courseMembers, m, now);
    const attended = canMark && attendance.some((a) => a.meetingId === m.id && a.userId === currentUser?.id);
    // ARU-60: completed meetings awaiting the check only (ARU-126 AC 8: no undo, so nothing once it's in history).
    const canMarkChecked = canCheck && m.status === 'completed' && !m.homeworkCheckedAt;
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
              icon="create-outline"
              label={t('meetings.editMeeting')}
              disabled={busy}
              onPress={() =>
                router.push({ pathname: '/courses/[id]/meetings/[meetingId]', params: { id: course.id, meetingId: m.id } })
              }
            />,
          ]
        : []),
      ...notesActions.map((a) =>
        a.mode === 'edit' ? (
          <ActionPill key="notes-edit" icon="create-outline" label={a.title} onPress={() => openNotes(m, 'edit')} />
        ) : a.mode === 'mine' ? (
          <ActionPill key="notes-mine" title={a.title} onPress={() => openNotes(m, 'mine')} />
        ) : (
          <ActionPill key="notes" title={a.title} role="link" onPress={() => openNotes(m, 'view')} />
        ),
      ),
      ...(canAssign
        ? [
            <ActionPill
              key="assign"
              title={t('meetings.assignHomework')}
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
        ? [<ActionPill key="attend" title={t('meetings.iAttended')} disabled={busy} onPress={() => markAttended(m)} />]
        : []),
      // ARU-88 AC 7: a status chip, not a button, so it doesn't look tappable.
      ...(attended
        ? [
            <View key="attended" style={[tile.pill, { backgroundColor: colors.successSoft }]}>
              <Text style={[tile.pillText, { color: colors.success }]}>{t('meetings.youAttended')}</Text>
            </View>,
          ]
        : []),
      ...(counts
        ? [
            <ActionPill
              key="count"
              role="link"
              icon="people-outline"
              title={t('meetings.attendedOf', { n: counts.attended.length, total: counts.total })}
              label={t('meetings.attendedCountLabel', { n: counts.attended.length, total: counts.total })}
              onPress={() =>
                router.push({
                  pathname: '/courses/[id]/meetings/[meetingId]/attendance',
                  params: { id: course.id, meetingId: m.id },
                })
              }
            />,
          ]
        : []),
      ...(canMarkChecked
        ? [
            <ActionPill
              key="check"
              icon="checkmark"
              tone="success"
              label={t('meetings.markHomeworkChecked')}
              disabled={busy}
              onPress={() => markChecked(m)}
            />,
          ]
        : []),
      ...actions
        .filter((a) => a.status === 'completed')
        .map((a) => (
          <ActionPill
            key="complete"
            icon="checkmark"
            tone="success"
            label={a.label}
            disabled={busy}
            onPress={() => changeStatus(m, a.status)}
          />
        )),
      ...(attended
        ? [
            <ActionPill
              key="undo"
              title={t('meetings.undo')}
              label={t('meetings.undoAttendance')}
              tone="danger"
              disabled={busy}
              onPress={() => undoAttended(m)}
            />,
          ]
        : []),
      ...actions
        .filter((a) => a.status === 'canceled')
        .map((a) => (
          <ActionPill
            key="cancel"
            icon="close"
            tone="danger"
            label={a.label}
            disabled={busy}
            onPress={() => changeStatus(m, a.status)}
          />
        )),
    ];

    // ARU-88 AC 1/2: its own tile, with a left bar in the group's colour. Not `accessible` as a whole, so screen
    // readers still reach each action (ARU-27).
    return (
      <View key={m.id} testID={`meeting-${m.id}`} style={[tile.tile, { borderLeftColor: meetingAccent[group] }]}>
        {/* ARU-129 AC 4: the date and time is the title (no topic), with the badge on the right that never gets
            squeezed off; a long localized date wraps. "Rescheduled" has its own small grey line. */}
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <Text style={tile.title}>{formatDateTime(m.startsAt)}</Text>
          <MeetingBadge meeting={m} now={now} />
        </View>
        {m.rescheduledAt ? (
          <Text style={tile.rescheduled} testID={`rescheduled-${m.id}`}>
            {t('meetings.rescheduled')}
          </Text>
        ) : null}
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
        {/* ARU-126 AC 1 / AC 7: "Homework: <title>", then Due on its own line; history tiles show neither. */}
        {assignment && group !== 'history' ? (
          <View testID={`assignment-${m.id}`}>
            <Text style={[styles.muted, { ...font(500), color: colors.text }]} numberOfLines={2}>
              {t('meetings.homeworkLine', { title: assignment.title })}
            </Text>
            <Text style={styles.muted} numberOfLines={1} testID={`assignment-due-${m.id}`}>
              {assignment.dueAt
                ? t('meetings.due', { when: formatDateTime(assignment.dueAt) })
                : t('meetings.noDeadline')}
            </Text>
          </View>
        ) : null}
        {/* AC 6: no divider and no footer when the meeting has no actions. "Saving…" replaces the footer. */}
        {footer.length > 0 && (
          <View testID={`actions-${m.id}`} style={tile.footer}>
            {changing === m.id ? <Text style={styles.muted}>{t('common.saving')}</Text> : footer}
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
  title: { flex: 1, fontSize: 14, ...font(600), color: colors.text },
  rescheduled: { fontSize: 12, color: colors.muted },
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
  // ARU-126: round icon-only pills (✓, ✕, pencil), the same 30 pt height as the text pills.
  iconPill: { width: 30, minWidth: 30, paddingHorizontal: 0, alignItems: 'center' },
  // The people count: icon then "7 of 8".
  iconTextPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // ARU-122: action pills and the attended chip are upper case by style (labels stay as written).
  pillText: { fontSize: 12, ...font(500), letterSpacing: 0.5, textTransform: 'uppercase' },
});
