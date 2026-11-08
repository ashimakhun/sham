// ARU-102: the new-material-notifications Edge Function's logic. Called by the triggers from migration 0048 (through
// pg_net) once per inserted Blog post or Knowledge base PDF, with {"type": "blog" | "file", "id": "<id>"} and
// "Authorization: Bearer <secret>". Asks new_material_recipients() who gets the message (the Approved readers of the
// item, except its author, who have a Telegram link with New materials on) and sends "New blog post from <author
// name>: <post title>" or "New file in the knowledge base from <author name>: <file name>" through the ARU-48 helper
// in one call, with kind new_material. Nothing is retried. No Deno-only imports, so Jest can test it.

import { localizedMessage, type SendResult, type TelegramMessage } from './telegram.ts';
import { telegramText, telegramTexts } from './telegram-texts.ts';
import { timingSafeEqual } from './telegram-bot.ts';

export type NewMaterialType = 'blog' | 'file';

/** One row of new_material_recipients(). */
export type NewMaterialRecipient = { user_id: string; author_name: string; item_title: string };

export type NewMaterialDeps = {
  /** Calls new_material_recipients(type, item) with the service role. Throws on a database error. */
  recipients: (type: NewMaterialType, id: string) => Promise<NewMaterialRecipient[]>;
  /** sendTelegramMessages() with the service-role client, the bot token and fetch. */
  send: (messages: TelegramMessage[]) => Promise<SendResult>;
  log?: (line: string) => void;
};

/** What a call returns (and logs), so a call can be checked from net._http_response without Telegram. */
export type NewMaterialReport = { recipients: number } & SendResult;

/** The message text, exactly as the story sets it (plain text: names and titles as typed; never the body, link,
 *  description or the PDF). */
export function newMaterialText(type: NewMaterialType, authorName: string, title: string) {
  return telegramText('en', type === 'blog' ? 'newBlogPost' : 'newKnowledgeFile', { name: authorName, title });
}

/** One message per recipient row. */
export function newMaterialMessages(type: NewMaterialType, rows: NewMaterialRecipient[]): TelegramMessage[] {
  return rows.map((r) =>
    localizedMessage(
      r.user_id,
      'new_material',
      telegramTexts(type === 'blog' ? 'newBlogPost' : 'newKnowledgeFile', { name: r.author_name, title: r.item_title }),
    ),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty: SendResult = { sent: 0, skipped: 0, failed: [], removed: 0 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The function: 401 unless Authorization is "Bearer <secret>" (AC 9), 400 for a missing or malformed type or id,
 * otherwise look up the recipients and send them all in one call. A failed message is logged and dropped (AC 8).
 */
export async function handleNewMaterialRequest(
  request: Request,
  secret: string,
  deps: NewMaterialDeps,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const given = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(given, `Bearer ${secret}`)) return new Response('Unauthorized', { status: 401 });

  let body: { type?: unknown; id?: unknown } | null = null;
  try {
    body = (await request.json()) as { type?: unknown; id?: unknown } | null;
  } catch {
    body = null;
  }
  const type = body?.type;
  const id = body?.id;
  if ((type !== 'blog' && type !== 'file') || typeof id !== 'string' || !UUID.test(id)) {
    deps.log?.('new-material: missing or malformed type or id');
    return json({ error: 'type must be "blog" or "file" and id a uuid' }, 400);
  }

  let rows: NewMaterialRecipient[];
  try {
    rows = await deps.recipients(type, id);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log?.(`new-material: ${type} ${id}: recipient lookup failed: ${error}`);
    return json({ error }, 500);
  }

  const messages = newMaterialMessages(type, rows);
  let result: SendResult = empty;
  if (messages.length) {
    try {
      result = await deps.send(messages);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result = { ...empty, failed: messages.map((m) => ({ userId: m.userId, error })) };
    }
  }
  const failed = result.failed.map((f) => `${f.userId}: ${f.error}`).join('; ');
  deps.log?.(
    `new-material: ${type} ${id}: ${messages.length} recipient(s), sent ${result.sent}, skipped ${result.skipped}, ` +
      `removed ${result.removed}, failed ${result.failed.length}${failed ? ` (${failed})` : ''}`,
  );
  const report: NewMaterialReport = { recipients: messages.length, ...result };
  return json(report);
}
