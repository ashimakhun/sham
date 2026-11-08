import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Button, Card } from '@/components/ui';
import { localMonth } from '@/lib/billing';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Course, PaymentRequest } from '@/lib/types';
import { useNow } from '@/lib/useNow';
import { usePaymentDues } from '@/lib/usePaymentDues';
import { font } from '@/lib/fonts';

/** "Payment request sent 5 Nov 2026 · waiting for the accountant" (AC 3). */
export function requestSentText(r: Pick<PaymentRequest, 'sentAt'>) {
  return `Payment request sent ${formatDate(r.sentAt)} · waiting for the accountant`;
}

/**
 * ARU-99 AC 1 / AC 3 / AC 4: on course details, an unpaid listener of a paid course in its payment period sees Pay,
 * or, once they sent a request this month, when it was sent and "Send again". Shown only while the course is due
 * (my_payment_dues(), the same rule as the red deadline on the course card); it disappears with the period and
 * once the accountant marks them Paid or Exempt. Reloaded when the screen gains focus and when the app comes back.
 */
export function PaySection({ course }: { course: Course }) {
  const { loadMyPaymentRequest } = useStore();
  const { dues, reload: reloadDues } = usePaymentDues();
  const month = localMonth(useNow());
  const due = dues.has(course.id);
  // undefined: not loaded yet; null: none this month.
  const [request, setRequest] = useState<PaymentRequest | null | undefined>(undefined);
  const latest = useRef(0);

  const loadRequest = useCallback(() => {
    const n = ++latest.current;
    loadMyPaymentRequest(course.id, month)
      .then((r) => n === latest.current && setRequest(r))
      // Unknown: show Pay (sending again only replaces the request).
      .catch(() => n === latest.current && setRequest(null));
  }, [loadMyPaymentRequest, course.id, month]);

  useFocusEffect(
    useCallback(() => {
      reloadDues();
      loadRequest();
    }, [reloadDues, loadRequest]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => state === 'active' && loadRequest());
    return () => sub.remove();
  }, [loadRequest]);

  if (!due || request === undefined) return null;
  const openPay = () => router.push({ pathname: '/courses/[id]/pay', params: { id: course.id } });

  if (!request) {
    return <Button title="Pay" onPress={openPay} />;
  }
  return (
    <View testID="payment-request-sent">
      <Card style={{ gap: 8 }}>
        <Text style={{ color: colors.text, ...font(500) }}>{requestSentText(request)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send again"
          accessibilityHint="Replaces the proof you sent this month"
          hitSlop={8}
          onPress={openPay}
          style={{ minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.primary, ...font(500) }}>Send again</Text>
        </Pressable>
      </Card>
    </View>
  );
}
