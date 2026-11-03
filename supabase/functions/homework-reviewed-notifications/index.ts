// ARU-49: a Telegram message to a homework's sender when it is checked. Called by the trigger from migration 0037
// (through pg_net, with "Authorization: Bearer <secret>" and {"homework_id": "<id>"}). The logic is in
// ../_shared/homework-reviewed.ts (tested with Jest); this file only wires it to Supabase and Telegram.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   TELEGRAM_BOT_TOKEN               the bot's token (already set for ARU-48)
//   HOMEWORK_REVIEWED_NOTIFY_SECRET  a random string; the same value goes into Vault as 'homework_reviewed_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the trigger sends the shared secret, not a Supabase JWT):
//   npx supabase functions deploy homework-reviewed-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleHomeworkReviewedRequest, type HomeworkRecipient } from '../_shared/homework-reviewed.ts';
import { sendTelegramMessages, type ServiceClient } from '../_shared/telegram.ts';

const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const secret = Deno.env.get('HOMEWORK_REVIEWED_NOTIFY_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleHomeworkReviewedRequest(request, secret, {
    async recipient(homeworkId) {
      const { data, error } = await supabase.rpc('homework_reviewed_recipient', { homework: homeworkId });
      if (error) throw new Error(error.message);
      return (data ?? []) as HomeworkRecipient[];
    },
    send: (messages) => sendTelegramMessages(supabase as unknown as ServiceClient, token, fetch, messages),
    log: (line) => console.log(line),
  }),
);
