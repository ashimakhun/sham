// ARU-151: a Telegram message to the course when someone publishes meeting notes. Called by the trigger from
// migration 0062 (through pg_net, with "Authorization: Bearer <secret>" and {"id": "<note id>"}). The logic is in
// ../_shared/meeting-notes.ts (tested with Jest); this file only wires it to Supabase and Telegram.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   TELEGRAM_BOT_TOKEN           the bot's token (already set for ARU-48)
//   MEETING_NOTES_NOTIFY_SECRET  a random string; the same value goes into Vault as 'meeting_notes_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the trigger sends the shared secret, not a Supabase JWT):
//   npx supabase functions deploy meeting-notes-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleMeetingNotesRequest, type MeetingNotesRecipient } from '../_shared/meeting-notes.ts';
import { sendTelegramMessages, type ServiceClient } from '../_shared/telegram.ts';

const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const secret = Deno.env.get('MEETING_NOTES_NOTIFY_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleMeetingNotesRequest(request, secret, {
    async recipients(id) {
      const { data, error } = await supabase.rpc('meeting_notes_recipients', { note: id });
      if (error) throw new Error(error.message);
      return (data ?? []) as MeetingNotesRecipient[];
    },
    send: (messages) => sendTelegramMessages(supabase as unknown as ServiceClient, token, fetch, messages),
    log: (line) => console.log(line),
  }),
);
