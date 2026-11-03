import { useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Card, EmptyState, ErrorText, HiddenBadge, styles } from '@/components/ui';
import { canSeeBilling, listenersOf, localMonth, paymentStatus, periodText, type PaymentStatus } from '@/lib/billing';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import { useAction } from '@/lib/useAction';
import { useNow } from '@/lib/useNow';

/**
 * ARU-66 AC 1 / AC 2 / AC 6: a paid course's current listeners for the current (device-local) month, each Unpaid,
 * Paid (with the date it was marked) or Exempt. Accountants and the teacher mark Paid, undo any Paid mark for this
 * month, and set or clear Exempt. Nothing changes on screen until the change is saved (the store reloads after it).
 */
export default function CoursePaymentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, courseBilling, getCourse, courseMembers, getUser, coursePayments, paymentExemptions, loading, refresh } =
    useStore();
  const month = localMonth(useNow());
  if (!canSeeBilling(currentUser)) {
    return <EmptyState title="Not allowed" hint="Only accountants and the teacher see payments." />;
  }
  const course = getCourse(id);
  const billing = courseBilling.find((b) => b.courseId === id);
  if (!course || !billing) {
    return <EmptyState title="Not a paid course" hint="This course isn't a paid course (any more)." />;
  }
  const listeners = listenersOf(course.id, courseMembers, getUser);
  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, { gap: 12 }]}
      data={listeners}
      keyExtractor={(l) => l.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />}
      ListHeaderComponent={
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={[styles.h1, { fontSize: 22, flexShrink: 1 }]} accessibilityRole="header">
              {course.title}
            </Text>
            {course.hidden ? <HiddenBadge /> : null}
          </View>
          <Text style={styles.muted}>{periodText(billing)}</Text>
        </View>
      }
      renderItem={({ item }) => (
        <ListenerRow
          courseId={course.id}
          userId={item.id}
          name={item.name}
          month={month}
          status={paymentStatus(course.id, item.id, month, coursePayments, paymentExemptions)}
        />
      )}
      ListEmptyComponent={<EmptyState title="No listeners yet" />}
    />
  );
}

function StatusLabel({ status }: { status: PaymentStatus }) {
  if (status.kind === 'exempt') return <Text style={[styles.muted, { fontWeight: '600' }]}>Exempt</Text>;
  if (status.kind === 'paid')
    return (
      <Text style={{ color: colors.success, fontWeight: '600' }}>Paid · {formatDate(status.payment.markedAt)}</Text>
    );
  return <Text style={{ color: colors.danger, fontWeight: '600' }}>Unpaid</Text>;
}

/** A text button; `label` (with the listener's name) is what screen readers read. */
function Action({
  text,
  label,
  onPress,
  disabled,
  danger,
}: {
  text: string;
  label: string;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={{ minHeight: 32, justifyContent: 'center' }}>
      <Text style={{ color: danger ? colors.danger : colors.primary, fontWeight: '600', opacity: disabled ? 0.4 : 1 }}>
        {text}
      </Text>
    </Pressable>
  );
}

function ListenerRow({
  courseId,
  userId,
  name,
  month,
  status,
}: {
  courseId: string;
  userId: string;
  name: string;
  month: string;
  status: PaymentStatus;
}) {
  const { markPaid, undoPaid, setExempt } = useStore();
  const { busy, error, run } = useAction();
  return (
    <View testID={`payment-${userId}`}>
      <Card style={{ gap: 6 }}>
        <Text style={[styles.title, { fontSize: 15 }]}>{name}</Text>
        <StatusLabel status={status} />
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          {status.kind === 'unpaid' && (
            <Action
              text="Mark paid"
              label={`Mark ${name} paid`}
              disabled={busy}
              onPress={() => run(() => markPaid(courseId, userId, month))}
            />
          )}
          {status.kind === 'paid' && (
            <Action
              text="Undo paid"
              label={`Undo paid for ${name}`}
              danger
              disabled={busy}
              onPress={() => run(() => undoPaid(courseId, userId, month))}
            />
          )}
          {status.kind === 'exempt' ? (
            <Action
              text="Clear exempt"
              label={`Clear exempt for ${name}`}
              disabled={busy}
              onPress={() => run(() => setExempt(courseId, userId, false))}
            />
          ) : (
            <Action
              text="Set exempt"
              label={`Set ${name} exempt`}
              disabled={busy}
              onPress={() => run(() => setExempt(courseId, userId, true))}
            />
          )}
        </View>
        <ErrorText error={error} />
      </Card>
    </View>
  );
}
