import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Card, ErrorText, styles } from '@/components/ui';
import { BILLING_DAY_MAX, BILLING_DAY_MIN, canSeeBilling, isAccountant, periodProblem, periodText } from '@/lib/billing';
import { confirmAction } from '@/lib/confirm';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { CourseBilling } from '@/lib/types';
import { useAction } from '@/lib/useAction';

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
      {paid.length === 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.muted}>No paid courses yet</Text>
          {accountant ? <Text style={styles.muted}>Tap &quot;Select courses&quot; to add one.</Text> : null}
        </View>
      ) : (
        paid.map(({ billing, course }) => <PaidCourseRow key={billing.courseId} billing={billing} title={course.title} />)
      )}
      {accountant && <Button title="Select courses" variant="secondary" onPress={() => router.push('/accountant/courses')} />}
    </Card>
    </View>
  );
}

function PaidCourseRow({ billing, title }: { billing: CourseBilling; title: string }) {
  const { currentUser, setBillingPeriod, unselectPaidCourse } = useStore();
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  const accountant = isAccountant(currentUser);
  return (
    <View style={{ gap: 4, paddingTop: 4 }} testID={`paid-${billing.courseId}`}>
      <Text style={[styles.title, { fontSize: 15 }]}>{title}</Text>
      <Text style={styles.muted}>{periodText(billing)}</Text>
      {editing ? (
        <PeriodEditor
          initial={billing}
          saveTitle="Save period"
          onCancel={() => setEditing(false)}
          onSave={async (s, e) => {
            await setBillingPeriod(billing.courseId, s, e);
            setEditing(false);
          }}
        />
      ) : (
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Change period" hitSlop={8} onPress={() => setEditing(true)}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Change period</Text>
          </Pressable>
          {accountant && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Unselect"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={8}
              onPress={() =>
                run(async () => {
                  const ok = await confirmAction(
                    'Unselect paid course',
                    `${title} will stop being a paid course for everyone.`,
                    'Unselect',
                    { destructive: true, cancelText: 'Keep' },
                  );
                  if (ok) await unselectPaidCourse(billing.courseId);
                })
              }>
              <Text style={{ color: colors.danger, fontWeight: '600', opacity: busy ? 0.4 : 1 }}>Unselect</Text>
            </Pressable>
          )}
        </View>
      )}
      <ErrorText error={error} />
    </View>
  );
}
