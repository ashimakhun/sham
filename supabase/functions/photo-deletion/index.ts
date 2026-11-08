// ARU-112: deletes homework photos 6 months after checking, warns their senders on Telegram 30 and 7 days before, and
// removes leftover photos from failed sends. Called once a day by the pg_cron job from migration 0051 (through
// pg_net, with the secret in x-cron-secret). The logic is in ../_shared/photo-deletion.ts (tested with Jest); this
// file only wires it to Supabase, Storage and Telegram.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   TELEGRAM_BOT_TOKEN     the bot's token (already set for ARU-48)
//   PHOTO_DELETION_SECRET  a random string; the same value goes into Vault as 'photo_deletion_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the cron job sends the secret, not a Supabase JWT):
//   npx supabase functions deploy photo-deletion --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { type DuePhoto, handlePhotoDeletionRequest, type PhotoWarning } from '../_shared/photo-deletion.ts';
import { sendTelegramMessages, type ServiceClient } from '../_shared/telegram.ts';

const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const secret = Deno.env.get('PHOTO_DELETION_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

Deno.serve((request) =>
  handlePhotoDeletionRequest(request, secret, {
    async start() {
      const rows = await rpc<{ start_date: string; first_run: boolean }[]>('start_photo_deletion');
      if (!rows?.[0]) throw new Error('start_photo_deletion() returned nothing');
      return rows[0];
    },
    async leftovers(max) {
      const rows = await rpc<{ name: string }[]>('leftover_homework_photos', { max_files: max });
      return (rows ?? []).map((r) => r.name);
    },
    async due(max) {
      return (await rpc<DuePhoto[]>('due_homework_photos', { max_photos: max })) ?? [];
    },
    async remove(paths) {
      // Only the homework bucket. A path that no longer exists is simply not in the result: not an error (AC 3).
      const { error } = await supabase.storage.from('homework').remove(paths);
      if (error) throw new Error(error.message);
    },
    async markRemoved(photos) {
      return await rpc<number>('mark_homework_photos_removed', {
        homework_ids: photos.map((p) => p.homework_id),
        photo_paths: photos.map((p) => p.photo_path),
      });
    },
    async claimWarnings() {
      return (await rpc<PhotoWarning[]>('claim_photo_deletion_warnings')) ?? [];
    },
    send: (messages) => sendTelegramMessages(supabase as unknown as ServiceClient, token, fetch, messages),
    log: (line) => console.log(line),
  }),
);
