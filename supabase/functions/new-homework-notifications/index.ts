// ARU-50: a Telegram message to a course's listeners when new homework is assigned. Called through pg_net by the
// after-insert trigger on homework_assignments (migration 0038), with "Authorization: Bearer <secret>". The logic is in
// ../_shared/new-homework.ts (tested with Jest); this file only wires it to Supabase and Telegram.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   TELEGRAM_BOT_TOKEN          the bot's token (already set for ARU-48)
//   NEW_HOMEWORK_NOTIFY_SECRET  a random string; the same value goes into Vault as 'new_homework_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the trigger sends the secret, not a Supabase JWT):
//   npx supabase functions deploy new-homework-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleNewHomeworkRequest, type NewHomeworkRecipient } from '../_shared/new-homework.ts';
import { sendTelegramMessages, type ServiceClient } from '../_shared/telegram.ts';

const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const secret = Deno.env.get('NEW_HOMEWORK_NOTIFY_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleNewHomeworkRequest(request, secret, {
    async recipients(assignmentId) {
      const { data, error } = await supabase.rpc('new_homework_recipients', { assignment: assignmentId });
      if (error) throw new Error(error.message);
      return (data ?? []) as NewHomeworkRecipient[];
    },
    send: (messages) => sendTelegramMessages(supabase as unknown as ServiceClient, token, fetch, messages),
    log: (line) => console.log(line),
  }),
);
