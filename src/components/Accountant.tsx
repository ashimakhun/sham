import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Button, Card, ErrorText, styles } from '@/components/ui';
import {
  BILLING_DAY_MAX,
  BILLING_DAY_MIN,
  canSeeBilling,
  isAccountant,
  localMonth,
  periodProblem,
  requestCountText,
  unpaidThisMonth,
  waitingRequests,
} from '@/lib/billing';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { CourseBilling } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useNow } from '@/lib/useNow';
import { font } from '@/lib/fonts';

/** One day of the month, 1-28, with − / + buttons (works with screen readers; no free text). */
function DayStepper({ label, value, onChange, disabled }: {
  label: string;
  value: number;
  onChange: (day: number) => void;
  disabled?: boolean;
}) {
  const step = (by: number) => onChange(Math.min(BILLING_DAY_MAX, Math.max(BILLING_DAY_MIN, value + by)));
  const box = (enabled: boolean) => ({
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    opacity: enabled ? 1 : 0.4,
  });
  const canDown = !disabled && value > BILLING_DAY_MIN;
  const canUp = !disabled && value < BILLING_DAY_MAX;
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.muted}>{label}</Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: BILLING_DAY_MIN, max: BILLING_DAY_MAX, now: value, text: `Day ${value}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (disabled) return;
          if (e.nativeEvent.actionName === 'increment') step(1);
          if (e.nativeEvent.actionName === 'decrement') step(-1);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, earlier`}
          disabled={!canDown}
          onPress={() => step(-1)}
          style={box(canDown)}>
          <Text style={[styles.title, { color: colors.primary }]}>−</Text>
        </Pressable>
        <Text style={[styles.title, { minWidth: 28, textAlign: 'center' }]}>{value}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, later`}
          disabled={!canUp}
          onPress={() => step(1)}
          style={box(canUp)}>
          <Text style={[styles.title, { color: colors.primary }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** ARU-65: a payment period editor (start and end day, 1-28) with Save and Cancel. */
export function PeriodEditor({
  initial,
  saveTitle,
  onSave,
  onCancel,
}: {
  initial: { startDay: number; endDay: number };
  saveTitle: string;
  onSave: (startDay: number, endDay: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [startDay, setStartDay] = useState(initial.startDay);
  const [endDay, setEndDay] = useState(initial.endDay);
  const { busy, error, run } = useAction();
  const problem = periodProblem(startDay, endDay);
  return (
    <View style={{ gap: 8, paddingTop: 4 }}>
      <View style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
        <DayStepper label="First day" value={startDay} onChange={setStartDay} disabled={busy} />
        <DayStepper label="Last day" value={endDay} onChange={setEndDay} disabled={busy} />
      </View>
      {problem ? <Text style={{ color: colors.danger }}>{problem}</Text> : null}
      <ErrorText error={error} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            title={busy ? 'Saving…' : saveTitle}
            disabled={!!problem || busy}
            onPress={() => run(() => onSave(startDay, endDay))}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}

/** ARU-65 AC 2 / AC 6 / AC 7: the Accountant section on the Profile tab (accountants and the teacher). */
export function AccountantSection() {
  const { currentUser, courseBilling, getCourse } = useStore();
  const now = useNow();
  if (!canSeeBilling(currentUser)) return null;
  const accountant = isAccountant(currentUser);
  // A billing row whose course the user can't read isn't listed (RLS already hides those, ARU-40).
  const paid = courseBilling
    .map((b) => ({ billing: b, course: getCourse(b.courseId) }))
    .filter((p): p is { billing: CourseBilling; course: NonNullable<typeof p.course> } => !!p.course)
    .sort((a, b) => a.course.title.localeCompare(b.course.title));
  return (
    <View testID="accountant-section">
    <Card style={{ gap: 10 }}>
      <Text style={styles.label} accessibilityRole="header">
        ACCOUNTANT
      </Text>
      <UnpaidThisMonth now={now} />
      {paid.length === 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.muted}>No paid courses yet</Text>
          {accountant ? <Text style={styles.muted}>Tap &quot;Select courses&quot; to add one.</Text> : null}
        </View>
      ) : (
        paid.map(({ billing, course }) => (
          <PaidCourseRow key={billing.courseId} billing={billing} title={course.title} now={now} />
        ))
      )}
      {accountant && <Button title="Select courses" variant="secondary" onPress={() => router.push('/accountant/courses')} />}
    </Card>
    </View>
  );
}

/**
 * ARU-66 AC 3 / AC 6: courses in their payment period today (device-local) with unpaid listeners, sorted by title,
 * names sorted. "Everyone has paid" when some course is in its period but nobody owes; nothing when none is.
 */
function UnpaidThisMonth({ now }: { now: number }) {
  const { courseBilling, getCourse, courseMembers, getUser, coursePayments, paymentExemptions } = useStore();
  const unpaid = unpaidThisMonth({
    billing: courseBilling,
    getCourse,
    members: courseMembers,
    getUser,
    payments: coursePayments,
    exemptions: paymentExemptions,
    now,
  });
  if (!unpaid) return null;
  return (
    <View testID="unpaid-this-month" style={{ gap: 6, paddingBottom: 4 }}>
      <Text style={[styles.title, { fontSize: 15 }]} accessibilityRole="header">
        Unpaid this month
      </Text>
      {unpaid.length === 0 ? (
        <Text style={{ color: colors.success, ...font(500) }}>Everyone has paid</Text>
      ) : (
        unpaid.map((c) => (
          <View key={c.courseId} testID={`unpaid-${c.courseId}`} style={{ gap: 2 }}>
            <Text style={{ ...font(500), color: colors.text }}>{c.title}</Text>
            <Text style={{ color: colors.danger }}>{c.names.join(', ')}</Text>
          </View>
        ))
      )}
    </View>
  );
}

/**
 * ARU-99 AC 5 / AC 6: one row per paid course: the title with ">" at the right edge; the whole row opens the course's
 * payments page (period, Change period and Unselect live there now). A badge counts this month's waiting requests,
 * live, with the same rule as "Unpaid this month".
 */
function PaidCourseRow({ billing, title, now }: { billing: CourseBilling; title: string; now: number }) {
  const { paymentRequests, courseMembers, coursePayments, paymentExemptions } = useStore();
  const waiting = waitingRequests({
    courseId: billing.courseId,
    month: localMonth(now),
    requests: paymentRequests,
    members: courseMembers,
    payments: coursePayments,
    exemptions: paymentExemptions,
  }).length;
  const label =
    waiting > 0 ? `${title}, ${waiting} payment ${waiting === 1 ? 'request' : 'requests'}` : `Payments for ${title}`;
  return (
    <View testID={`paid-${billing.courseId}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the listeners, their payment requests and who has paid this month"
        onPress={() => router.push({ pathname: '/accountant/[id]', params: { id: billing.courseId } })}
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingTop: 4 },
          pressed && { opacity: 0.6 },
        ]}>
        <Text style={[styles.title, { fontSize: 15, flex: 1 }]}>{title}</Text>
        {waiting > 0 ? (
          <View
            testID={`requests-${billing.courseId}`}
            style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: '#fff', fontSize: 12, ...font(600) }}>{requestCountText(waiting)}</Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}
