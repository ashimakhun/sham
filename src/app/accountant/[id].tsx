import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, Text, View } from 'react-native';

import { PeriodEditor } from '@/components/Accountant';
import { PhotoPreview } from '@/components/PhotoPreview';
import { Card, EmptyState, ErrorText, HiddenBadge, styles } from '@/components/ui';
import {
  byPaymentRank,
  canSeeBilling,
  inFrozenOrder,
  isAccountant,
  listenersOf,
  localMonth,
  paymentRank,
  paymentStatus,
  periodText,
  waitingRequests,
  type PaymentStatus,
} from '@/lib/billing';
import { confirmAction } from '@/lib/confirm';
import { PROOF_LOAD_ERROR, proofFileName } from '@/lib/paymentProof';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { CourseBilling, PaymentRequest } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useNow } from '@/lib/useNow';

/**
 * ARU-66 AC 1 / AC 2 / AC 6: a paid course's current listeners for the current (device-local) month, each Unpaid,
 * Paid (with the date it was marked) or Exempt. Accountants and the teacher mark Paid, undo any Paid mark for this
 * month, and set or clear Exempt. Nothing changes on screen until the change is saved (the store reloads after it).
 * ARU-99 AC 8-11: the header has the period, Change period and Unselect (moved here from the Profile row); a
 * listener's waiting request for this month shows under their name with View proof, and they are listed first.
 * ARU-124: the list is sorted (request, unpaid, paid, exempt; A–Z within each) when the screen gains focus and after
 * pull to refresh. In between the order is frozen, so marking someone doesn't move their row (AC 2).
 */
export default function CoursePaymentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    currentUser,
    courseBilling,
    getCourse,
    courseMembers,
    getUser,
    coursePayments,
    paymentExemptions,
    paymentRequests,
    loading,
    refresh,
  } = useStore();
  const month = localMonth(useNow());
  // ARU-124 AC 3: bumping sortKey re-sorts the list (on focus and after pull to refresh); store reloads don't.
  const [sortKey, setSortKey] = useState(0);
  const [frozen, setFrozen] = useState<{ key: number; ids: string[] } | null>(null);
  useFocusEffect(
    useCallback(() => {
      setSortKey((k) => k + 1);
    }, [setSortKey]),
  );
  if (!canSeeBilling(currentUser)) {
    return <EmptyState title="Not allowed" hint="Only accountants and the teacher see payments." />;
  }
  const course = getCourse(id);
  const billing = courseBilling.find((b) => b.courseId === id);
  if (!course || !billing) {
    return <EmptyState title="Not a paid course" hint="This course isn't a paid course (any more)." />;
  }
  const waiting = waitingRequests({
    courseId: course.id,
    month,
    requests: paymentRequests,
    members: courseMembers,
    payments: coursePayments,
    exemptions: paymentExemptions,
  });
  const requestOf = new Map(waiting.map((r) => [r.userId, r]));
  const live = listenersOf(course.id, courseMembers, getUser);
  const statusOf = (userId: string) => paymentStatus(course.id, userId, month, coursePayments, paymentExemptions);
  // AC 1 on a new sort; otherwise (AC 2) the last order, with new listeners at the end. If nobody from the last order
  // is left (e.g. the store hadn't loaded yet when the screen opened), sort afresh.
  const last = frozen;
  const fresh = !last || last.key !== sortKey || !live.some((l) => last.ids.includes(l.id));
  const listeners = fresh
    ? byPaymentRank(live, (userId) => paymentRank(statusOf(userId), requestOf.has(userId)))
    : inFrozenOrder(live, last.ids);
  const ids = listeners.map((l) => l.id);
  if (!last || last.key !== sortKey || ids.join('\n') !== last.ids.join('\n')) setFrozen({ key: sortKey, ids });
  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, { gap: 12 }]}
      data={listeners}
      keyExtractor={(l) => l.id}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={() =>
            refresh()
              .catch(() => {})
              .then(() => setSortKey((k) => k + 1))
          }
        />
      }
      ListHeaderComponent={<CourseHeader billing={billing} title={course.title} hidden={!!course.hidden} />}
      renderItem={({ item }) => (
        <ListenerRow
          courseId={course.id}
          courseTitle={course.title}
          userId={item.id}
          name={item.name}
          month={month}
          status={statusOf(item.id)}
          request={requestOf.get(item.id)}
        />
      )}
      ListEmptyComponent={<EmptyState title="No listeners yet" />}
    />
  );
}

/** AC 8: title, period, Change period (accountants and the teacher) and Unselect (accountants only). */
function CourseHeader({ billing, title, hidden }: { billing: CourseBilling; title: string; hidden: boolean }) {
  const { currentUser, setBillingPeriod, unselectPaidCourse } = useStore();
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  const accountant = isAccountant(currentUser);
  return (
    <View style={{ gap: 4 }} testID="payments-header">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={[styles.h1, { fontSize: 22, flexShrink: 1 }]} accessibilityRole="header">
          {title}
        </Text>
        {hidden ? <HiddenBadge /> : null}
      </View>
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

/** AC 9: "Payment request · <date>" and View proof: a photo full-screen (with Download), a PDF in the browser. */
function RequestLine({ request, courseTitle, name }: { request: PaymentRequest; courseTitle: string; name: string }) {
  const { getPaymentProofUrl } = useStore();
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function view() {
    setError(null);
    if (request.proofType === 'image') {
      setPreview(true);
      return;
    }
    // As Knowledge base PDFs: a short-lived signed link, opened by the system.
    setOpening(true);
    try {
      await Linking.openURL(await getPaymentProofUrl(request.proofPath, { expiresIn: 60 }));
    } catch {
      setError(PROOF_LOAD_ERROR);
    } finally {
      setOpening(false);
    }
  }

  return (
    <View testID={`request-${request.userId}`} style={{ gap: 2 }}>
      <Text style={{ color: colors.text }}>Payment request · {formatDate(request.sentAt)}</Text>
      <Action
        text={opening ? 'Opening…' : 'View proof'}
        label={`View payment proof from ${name}`}
        disabled={opening}
        onPress={view}
      />
      <ErrorText error={error} />
      {preview && (
        <PhotoPreview
          path={request.proofPath}
          loadUrl={getPaymentProofUrl}
          fileName={proofFileName(courseTitle, name)}
          errorText={PROOF_LOAD_ERROR}
          onClose={() => setPreview(false)}
        />
      )}
    </View>
  );
}

function ListenerRow({
  courseId,
  courseTitle,
  userId,
  name,
  month,
  status,
  request,
}: {
  courseId: string;
  courseTitle: string;
  userId: string;
  name: string;
  month: string;
  status: PaymentStatus;
  request?: PaymentRequest;
}) {
  const { markPaid, undoPaid, setExempt } = useStore();
  const { busy, error, run } = useAction();
  return (
    <View testID={`payment-${userId}`}>
      <Card style={{ gap: 6 }}>
        <Text style={[styles.title, { fontSize: 15 }]}>{name}</Text>
        <StatusLabel status={status} />
        {request ? <RequestLine request={request} courseTitle={courseTitle} name={name} /> : null}
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
