// ARU-41: a Telegram message to a course's listeners when one of its meetings starts. Called every minute by the
// pg_cron job from migration 0035 (through pg_net, with the secret in x-cron-secret). The logic is in
// ../_shared/meeting-start.ts (tested with Jest); this file only wires it to Supabase and Telegram.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   TELEGRAM_BOT_TOKEN     the bot's token (already set for ARU-48)
//   MEETING_NOTIFY_SECRET  a random string; the same value goes into Vault as 'meeting_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the cron job sends the secret, not a Supabase JWT):
//   npx supabase functions deploy meeting-start-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { type ClaimedMeeting, handleMeetingStartRequest } from '../_shared/meeting-start.ts';
import { sendTelegramMessages, type ServiceClient } from '../_shared/telegram.ts';

const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const secret = Deno.env.get('MEETING_NOTIFY_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleMeetingStartRequest(request, secret, {
    async claim() {
      const { data, error } = await supabase.rpc('claim_started_meetings');
      if (error) throw new Error(error.message);
      return (data ?? []) as ClaimedMeeting[];
    },
    send: (messages) => sendTelegramMessages(supabase as unknown as ServiceClient, token, fetch, messages),
    log: (line) => console.log(line),
  }),
);
