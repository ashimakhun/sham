import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { localDay } from './billing';
import { useStore } from './store';
import type { PaymentDue } from './types';
import { useNow } from './useNow';

/**
 * ARU-66 AC 7 / AC 8: the signed-in listener's own due courses (course id -> deadline, YYYY-MM-DD), from
 * my_payment_dues() with the device-local date. ARU-148: a course stays due after its deadline until the end of that
 * month (unpaid and overdue); `overdue` holds the ids of those courses. Not live: it reloads when the device-local date changes (checked
 * every 30 s, so a period starting or ending shows within a minute), when the app returns to the foreground, and
 * whenever the caller calls `reload` (the Courses tab does on focus). An error shows no highlight and no banner.
 */
export function usePaymentDues() {
  const { currentUser, loadPaymentDues } = useStore();
  const today = localDay(useNow());
  const [dues, setDues] = useState<PaymentDue[]>([]);
  const request = useRef(0);
  // The latest loader and date, so `reload` stays stable for focus effects.
  const latest = useRef({ loadPaymentDues, today, signedIn: !!currentUser });
  // Declared before the effects below, so it runs first in each commit.
  useEffect(() => {
    latest.current = { loadPaymentDues, today, signedIn: !!currentUser };
  });

  const reload = useCallback(() => {
    const { loadPaymentDues: load, today: day, signedIn } = latest.current;
    const n = ++request.current;
    if (!signedIn) {
      setDues([]);
      return;
    }
    Promise.resolve()
      .then(() => load(day))
      .then((rows) => {
        if (n === request.current) setDues(rows);
      })
      .catch(() => {
        if (n === request.current) setDues([]);
      });
  }, []);

  const userId = currentUser?.id;
  useEffect(() => {
    reload();
  }, [today, userId, reload]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reload();
    });
    return () => sub.remove();
  }, [reload]);

  // ARU-148: a due from an earlier month is dropped at once (the 1st starts fresh, AC 6), before the reload answers.
  // One whose deadline has passed in this month turns overdue at once, so the card keeps its border at midnight (AC 5).
  const month = today.slice(0, 7);
  const map = new Map<string, string>();
  const overdue = new Set<string>();
  for (const d of dues) {
    if (d.deadline.slice(0, 7) < month) continue;
    map.set(d.courseId, d.deadline);
    if (d.overdue || d.deadline < today) overdue.add(d.courseId);
  }
  return { dues: map, overdue, reload };
}
