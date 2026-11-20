// Test helpers (not a test file): a fake service-role client and a fake Expo push service for the end-to-end tests of
// each notification function with the real push sender (ARU-171 moved these tests from Telegram to push).
//
// The old tests described recipients as "links" ({ user_id, chat_id, notify_*: boolean }). pushClient() keeps that
// shape: each row is both the recipient's notification_settings row (its notify_* switches) and one registered phone
// with the token `ExponentPushToken[<chat_id>]`. Someone without a row has no phone, so they are skipped.

import type { PushServiceClient } from './push.ts';

export type RecipientRow = { user_id: string; chat_id: number | string } & Record<string, unknown>;
export type ProfileRow = { id: string; language?: string | null; device_language?: string | null };

export const tokenFor = (chatId: number | string) => `ExponentPushToken[${chatId}]`;

export function pushClient(
  rows: RecipientRow[],
  profiles: ProfileRow[] = [],
  { fail, profilesError = false }: { fail?: string; profilesError?: boolean } = {},
) {
  const reads: { table: string; columns: string; ids: string[] }[] = [];
  const deleted: string[] = [];
  const client: PushServiceClient = {
    from: (table) => ({
      select: (columns: string) => ({
        in: async (_col: string, ids: string[]) => {
          reads.push({ table, columns, ids: [...ids] });
          if (fail === table) return { data: null, error: { message: `${table} down` } };
          const mine = rows.filter((r) => ids.includes(r.user_id));
          if (table === 'profiles') {
            if (profilesError) return { data: null, error: { message: 'boom' } };
            return { data: profiles.filter((p) => ids.includes(p.id)), error: null };
          }
          if (table === 'push_devices') {
            return { data: mine.map((r) => ({ user_id: r.user_id, token: tokenFor(r.chat_id) })), error: null };
          }
          return { data: mine.map(({ chat_id: _c, ...settings }) => settings), error: null };
        },
      }),
      delete: () => ({
        in: async (_col: string, tokens: string[]) => {
          deleted.push(...tokens);
          return { data: null, error: null };
        },
      }),
    }),
  };
  return { client, reads, deleted };
}

type PushPayload = { to: string; title: string; body: string } & Record<string, unknown>;
export type PushAnswer = { status: number; body?: unknown; retryAfter?: number } | Error;

/**
 * A fake Expo push service. Each request takes the next answer (default: 200 with an ok ticket per notification).
 * `sent()` lists every notification of every request as [chat id, body], in order.
 */
export function pushFetch(answers: ((batch: PushPayload[]) => PushAnswer)[] = []) {
  const requests: { url: string; headers: Record<string, string>; batch: PushPayload[] }[] = [];
  const fn = jest.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const batch = JSON.parse(init.body) as PushPayload[];
    requests.push({ url, headers: init.headers, batch });
    const answer = answers.shift()?.(batch) ?? { status: 200, body: okTickets(batch.length) };
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      statusText: '',
      headers: { get: (h: string) => (h === 'retry-after' && answer.retryAfter ? String(answer.retryAfter) : null) },
      json: async () => answer.body,
    };
  });
  const sent = () =>
    requests.flatMap((r) =>
      r.batch.map((p) => {
        const id = /^ExponentPushToken\[(.*)\]$/.exec(p.to)?.[1] ?? p.to;
        return [/^\d+$/.test(id) ? Number(id) : id, p.body] as [number | string, string];
      }),
    );
  return { fetch: fn as unknown as typeof fetch, mock: fn, requests, sent };
}

export const okTickets = (n: number) => ({ data: Array.from({ length: n }, () => ({ status: 'ok', id: 'x' })) });
