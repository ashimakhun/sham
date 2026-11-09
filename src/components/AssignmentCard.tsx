import { router } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/AppText';

import { Button, Card, styles } from '@/components/ui';
import { currentLanguage, type Language, translate } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { HomeworkAssignment } from '@/lib/types';

/**
 * "Due …" / "No deadline", and whether the deadline has passed (ARU-32). In the app's language (ARU-109); components
 * pass `lang` from useI18n so they re-render when it changes.
 */
export function dueText(assignment: Pick<HomeworkAssignment, 'dueAt'>, lang: Language = currentLanguage()) {
  return assignment.dueAt
    ? translate(lang, 'homework.due', { date: formatDateTime(assignment.dueAt) })
    : translate(lang, 'homework.noDeadline');
}
export function isOverdue(assignment: Pick<HomeworkAssignment, 'dueAt'>, now: number) {
  return !!assignment.dueAt && new Date(assignment.dueAt).getTime() <= now;
}

/**
 * Whether the deadline falls on `now`'s local calendar day (ARU-95), whatever its time, so it stays true after the
 * deadline time passes and turns false at local midnight.
 */
export function isDueToday(assignment: Pick<HomeworkAssignment, 'dueAt'>, now: number) {
  if (!assignment.dueAt) return false;
  const due = new Date(assignment.dueAt);
  const today = new Date(now);
  return (
    due.getFullYear() === today.getFullYear() && due.getMonth() === today.getMonth() && due.getDate() === today.getDate()
  );
}

/**
 * Whether a New-list card gets the thin red border: due on `now`'s local day (ARU-95), or overdue from an earlier day
 * until the homework is sent (ARU-121). No deadline or a later day: no border.
 */
export function needsAttention(assignment: Pick<HomeworkAssignment, 'dueAt'>, now: number) {
  return isDueToday(assignment, now) || isOverdue(assignment, now);
}

/** The thin red border of a card that needs attention, as on the "Payment due" course card (ARU-66). */
const attentionBorder = { borderWidth: 1, borderColor: colors.danger };

export function OverdueBadge() {
  const { t } = useI18n();
  return (
    <View style={[styles.badge, { backgroundColor: '#FEF2F2' }]}>
      <Text style={[styles.badgeText, { color: colors.danger }]}>{t('homework.overdue')}</Text>
    </View>
  );
}

/** A homework assignment the listener hasn't sent homework for yet: the "New" list (ARU-32 AC 6). */
export function AssignmentCard({ item, now }: { item: HomeworkAssignment; now: number }) {
  const { getCourse, meetings } = useStore();
  const { t, lang } = useI18n();
  const meeting = meetings.find((m) => m.id === item.meetingId);
  const dueToday = isDueToday(item, now);
  const highlight = needsAttention(item, now);
  // One flag drives both the border and the testID: "due-today" for today's cards, "overdue" for earlier days.
  const testID = highlight ? `assignment-${dueToday ? 'due-today' : 'overdue'}-${item.id}` : undefined;
  return (
    <Card testID={testID} style={highlight ? attentionBorder : undefined}>
      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <Text style={[styles.title, { flex: 1 }]} numberOfLines={2}>
          {item.title}
        </Text>
        {isOverdue(item, now) && <OverdueBadge />}
      </View>
      <Text style={[styles.label, { color: colors.primary }]} numberOfLines={2}>
        {getCourse(item.courseId)?.title ?? t('homework.noCourse')}
      </Text>
      {meeting ? (
        <Text style={styles.muted}>{t('homework.meetingAt', { date: formatDateTime(meeting.startsAt) })}</Text>
      ) : null}
      {item.description ? (
        <Text style={styles.body} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
      <Text style={styles.muted}>{dueText(item, lang)}</Text>
      <Button
        title={t('homework.addButton')}
        variant="secondary"
        onPress={() => router.push({ pathname: '/homework/new', params: { assignmentId: item.id } })}
      />
    </Card>
  );
}
