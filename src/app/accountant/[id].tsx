import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, Text, View } from 'react-native';

import { PeriodEditor } from '@/components/Accountant';
import { PhotoPreview } from '@/components/PhotoPreview';
import { Card, EmptyState, ErrorText, HiddenBadge, IconButton, styles } from '@/components/ui';
import {
  canSeeBilling,
  isAccountant,
  listenersOf,
  localMonth,
  paymentStatus,
  periodText,
  waitingRequests,
  type PaymentStatus,
} from '@/lib/billing';
import { confirmAction, confirmDestructive } from '@/lib/confirm';
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
  // Listeners with a waiting request first; the rest keep the usual order (by name). sort() is stable.
  const listeners = listenersOf(course.id, courseMembers, getUser).sort(
    (a, b) => Number(requestOf.has(b.id)) - Number(requestOf.has(a.id)),
  );
  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, { gap: 12 }]}
      data={listeners}
      keyExtractor={(l) => l.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />}
      ListHeaderComponent={<CourseHeader billing={billing} title={course.title} hidden={!!course.hidden} />}
      renderItem={({ item }) => (
        <ListenerRow
          courseId={course.id}
          courseTitle={course.title}
          userId={item.id}
          name={item.name}
          month={month}
          status={paymentStatus(course.id, item.id, month, coursePayments, paymentExemptions)}
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

/** ARU-118 AC 1: the status as a small rounded badge (read as text, not a button). */
function StatusBadge({ status }: { status: PaymentStatus }) {
  const [text, color, backgroundColor] =
    status.kind === 'exempt'
      ? ['Exempt', colors.muted, colors.mutedSoft]
      : status.kind === 'paid'
        ? [`Paid · ${formatDate(status.payment.markedAt)}`, colors.success, colors.successSoft]
        : ['Unpaid', colors.danger, colors.dangerSoft];
  return (
    <View style={[styles.badge, { backgroundColor }]} testID="status-badge">
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
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

/**
 * ARU-99 AC 9: View proof opens a photo full-screen (with Download), a PDF in the browser. ARU-118 AC 7: the link
 * sits in the row's links row; it has its own `opening` state, separate from the row's busy state.
 */
function useProofViewer(request: PaymentRequest | undefined) {
  const { getPaymentProofUrl } = useStore();
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function view() {
    if (!request) return;
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

  return { preview, closePreview: () => setPreview(false), error, opening, view, getPaymentProofUrl };
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
  const proof = useProofViewer(request);
  return (
    <View testID={`payment-${userId}`}>
      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.title, { fontSize: 15 }]}>{name}</Text>
            <StatusBadge status={status} />
            {request ? (
              <Text testID={`request-${request.userId}`} style={{ color: colors.text }}>
                Payment request · {formatDate(request.sentAt)}
              </Text>
            ) : null}
            {/* AC 7: View proof and Set / Clear exempt on one row; Set exempt only for Unpaid listeners. */}
            <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
              {request ? (
                <Action
                  text={proof.opening ? 'Opening…' : 'View proof'}
                  label={`View payment proof from ${name}`}
                  disabled={proof.opening}
                  onPress={proof.view}
                />
              ) : null}
              {status.kind === 'exempt' && (
                <Action
                  text="Clear exempt"
                  label={`Clear exempt for ${name}`}
                  disabled={busy}
                  onPress={() => run(() => setExempt(courseId, userId, false))}
                />
              )}
              {status.kind === 'unpaid' && (
                <Action
                  text="Set exempt"
                  label={`Set ${name} exempt`}
                  disabled={busy}
                  onPress={() => run(() => setExempt(courseId, userId, true))}
                />
              )}
            </View>
          </View>
          {/* AC 2-5: a green check mark marks Paid at once; a red X undoes Paid after a confirmation. */}
          {status.kind === 'unpaid' && (
            <IconButton
              icon="checkmark"
              tone="success"
              label={`Mark ${name} paid`}
              testID={`mark-paid-${userId}`}
              disabled={busy}
              onPress={() => run(() => markPaid(courseId, userId, month))}
            />
          )}
          {status.kind === 'paid' && (
            <IconButton
              icon="close"
              tone="danger"
              label={`Undo paid for ${name}`}
              testID={`undo-paid-${userId}`}
              disabled={busy}
              onPress={() =>
                run(async () => {
                  const ok = await confirmDestructive(
                    'Undo paid',
                    `Undo paid for ${name} for this month? They will show as Unpaid.`,
                    'Undo paid',
                  );
                  if (ok) await undoPaid(courseId, userId, month);
                })
              }
            />
          )}
        </View>
        <ErrorText error={proof.error} />
        <ErrorText error={error} />
        {proof.preview && request && (
          <PhotoPreview
            path={request.proofPath}
            loadUrl={proof.getPaymentProofUrl}
            fileName={proofFileName(courseTitle, name)}
            errorText={PROOF_LOAD_ERROR}
            onClose={proof.closePreview}
          />
        )}
      </Card>
    </View>
  );
}
