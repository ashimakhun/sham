// ARU-84: a Telegram message to the teacher when a new account waits for approval. Called by the trigger from
// migration 0044 (through pg_net, with "Authorization: Bearer <secret>" and {"user_id": "<id>"}). The logic is in
// ../_shared/new-account.ts (tested with Jest); this file only wires it to Supabase and Telegram.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   TELEGRAM_BOT_TOKEN         the bot's token (already set for ARU-48)
//   NEW_ACCOUNT_NOTIFY_SECRET  a random string; the same value goes into Vault as 'new_account_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the trigger sends the shared secret, not a Supabase JWT):
//   npx supabase functions deploy new-account-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleNewAccountRequest, type NewAccountRecipient } from '../_shared/new-account.ts';
import { sendTelegramMessages, type ServiceClient } from '../_shared/telegram.ts';

const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const secret = Deno.env.get('NEW_ACCOUNT_NOTIFY_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleNewAccountRequest(request, secret, {
    async recipient(userId) {
      const { data, error } = await supabase.rpc('new_account_notification', { account: userId });
      if (error) throw new Error(error.message);
      return (data ?? []) as NewAccountRecipient[];
    },
    send: (messages) => sendTelegramMessages(supabase as unknown as ServiceClient, token, fetch, messages),
    log: (line) => console.log(line),
  }),
);
