import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { type Store, useStore } from './store';
import type { ChatMessage, CourseMessage } from './types';

/** Newest first; created_at then id, so messages with the same timestamp keep one order for everyone. */
function newestFirst(a: ChatMessage, b: ChatMessage) {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** Adds messages to a list without duplicates (realtime, refetch and own sends can all deliver the same one). */
export function mergeMessages<M extends ChatMessage>(list: M[], more: M[]) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of more) byId.set(m.id, m);
  return [...byId.values()].sort(newestFirst);
}

/** Where a chat's messages come from: the store functions for one course's chat or for the general chat. */
export type ChatSource<M extends ChatMessage> = {
  load: (store: Store, before?: M) => Promise<{ messages: M[]; hasMore: boolean }>;
  subscribe: (store: Store, onMessage: (m: M) => void) => () => void;
  send: (store: Store, id: string, body: string) => Promise<void>;
};

/** One course's chat (ARU-8). */
export function useCourseChat(courseId: string, enabled: boolean) {
  const source = useMemo<ChatSource<CourseMessage>>(
    () => ({
      load: (store, before) => store.loadMessages(courseId, before),
      subscribe: (store, onMessage) => store.subscribeToMessages(courseId, onMessage),
      send: (store, id, body) => store.sendMessage({ id, courseId, body }),
    }),
    [courseId],
  );
  return useChat(source, enabled);
}

const generalSource: ChatSource<ChatMessage> = {
  load: (store, before) => store.loadGeneralMessages(before),
  subscribe: (store, onMessage) => store.subscribeToGeneralMessages(onMessage),
  send: (store, id, body) => store.sendGeneralMessage({ id, body }),
};

/** The general chat for every approved user (ARU-61). */
export function useGeneralChat(enabled: boolean) {
  return useChat(generalSource, enabled);
}

/**
 * A chat: the latest page, older pages on demand, live inserts on the chat's own channel, and a refetch of the
 * latest page when the screen regains focus or the app returns to the foreground. `source` must be stable (memoised
 * per chat). `enabled` is false when the user is not (or no longer) in the chat.
 */
export function useChat<M extends ChatMessage>(source: ChatSource<M>, enabled: boolean) {
  const store = useStore();
  // The store object is rebuilt on every render; keep its functions in a ref so effects run per chat only.
  const api = useRef(store);

  const [messages, setMessages] = useState<M[]>([]);
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
      const page = await source.load(api.current);
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
  }, [source, enabled]);

  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[messagesRef.current.length - 1];
    if (!enabled || !hasMore || loadingOlder || !oldest) return;
    setLoadingOlder(true);
    try {
      const page = await source.load(api.current, oldest);
      setMessages((list) => mergeMessages(list, page.messages));
      setHasMore(page.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  }, [source, enabled, hasMore, loadingOlder]);

  // Live inserts on this chat's own channel only.
  useEffect(() => {
    if (!enabled) return;
    return source.subscribe(api.current, (m) => setMessages((list) => mergeMessages(list, [m])));
  }, [source, enabled]);

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
      await source.send(api.current, id, body);
      // Show it at once; realtime may deliver it again, which merge ignores.
      await loadLatest();
    },
    [source, loadLatest],
  );

  return { messages, hasMore, loaded, loadingOlder, error, loadOlder, send };
}
