import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useStore } from './store';
import type { CourseMessage } from './types';

/** Newest first; created_at then id, so messages with the same timestamp keep one order for everyone. */
function newestFirst(a: CourseMessage, b: CourseMessage) {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** Adds messages to a list without duplicates (realtime, refetch and own sends can all deliver the same one). */
export function mergeMessages(list: CourseMessage[], more: CourseMessage[]) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of more) byId.set(m.id, m);
  return [...byId.values()].sort(newestFirst);
}

/**
 * One course's chat (ARU-8): the latest page, older pages on demand, live inserts on the course's own channel,
 * and a refetch of the latest page when the screen regains focus or the app returns to the foreground.
 * `enabled` is false when the user is not (or no longer) in the chat.
 */
export function useCourseChat(courseId: string, enabled: boolean) {
  const store = useStore();
  // The store object is rebuilt on every render; keep its functions in a ref so effects run per course only.
  const api = useRef(store);

  const [messages, setMessages] = useState<CourseMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef(messages);
  useEffect(() => {
    api.current = store;
    messagesRef.current = messages;
  });

  const loadLatest = useCallback(async () => {
    if (!enabled) return;
    try {
      const page = await api.current.loadMessages(courseId);
      const newestShown = messagesRef.current[0];
      const oldestFetched = page.messages[page.messages.length - 1];
      // A gap: more than a page arrived since the newest message shown (e.g. while in the background), so
      // the fresh page doesn't reach back to it. Paging only goes backwards from the oldest message shown and
      // would never fill the gap, so start over from the fresh page; scrolling up then loads everything older.
      const gap = !!newestShown && page.hasMore && !!oldestFetched && newestFirst(oldestFetched, newestShown) < 0;
      if (!newestShown || gap) {
        setMessages(page.messages);
        setHasMore(page.hasMore);
      } else {
        // Overlaps what is shown: just add what was missed; whether older pages exist is unchanged.
        setMessages((list) => mergeMessages(list, page.messages));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load messages.');
    } finally {
      setLoaded(true);
    }
  }, [courseId, enabled]);

  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[messagesRef.current.length - 1];
    if (!enabled || !hasMore || loadingOlder || !oldest) return;
    setLoadingOlder(true);
    try {
      const page = await api.current.loadMessages(courseId, oldest);
      setMessages((list) => mergeMessages(list, page.messages));
      setHasMore(page.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  }, [courseId, enabled, hasMore, loadingOlder]);

  // Live inserts on this course's channel only.
  useEffect(() => {
    if (!enabled) return;
    return api.current.subscribeToMessages(courseId, (m) => setMessages((list) => mergeMessages(list, [m])));
  }, [courseId, enabled]);

  // First load, and again whenever the screen regains focus (e.g. back from another screen).
  useFocusEffect(
    useCallback(() => {
      loadLatest();
    }, [loadLatest]),
  );

  // Catch up on messages missed while the app was in the background (realtime may have disconnected).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadLatest();
    });
    return () => sub.remove();
  }, [loadLatest]);

  const send = useCallback(
    async (id: string, body: string) => {
      await api.current.sendMessage({ id, courseId, body });
      // Show it at once; realtime may deliver it again, which merge ignores.
      await loadLatest();
    },
    [courseId, loadLatest],
  );

  return { messages, hasMore, loaded, loadingOlder, error, loadOlder, send };
}
