// ARU-102: a Telegram message when a new Blog post or Knowledge base PDF is shared on Materials. Called by the
// triggers from migration 0048 (through pg_net, with "Authorization: Bearer <secret>" and {"type": "blog" | "file",
// "id": "<id>"}). The logic is in ../_shared/new-material.ts (tested with Jest); this file only wires it to Supabase
// and Telegram.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   EXPO_ACCESS_TOKEN         optional (ARU-166): only if push security is turned on in Expo. Since ARU-166 this
//                             function sends push notifications, not Telegram: TELEGRAM_BOT_TOKEN is no longer read.
//   NEW_MATERIAL_NOTIFY_SECRET  a random string; the same value goes into Vault as 'new_material_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the trigger sends the shared secret, not a Supabase JWT):
//   npx supabase functions deploy new-material-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleNewMaterialRequest, type NewMaterialRecipient } from '../_shared/new-material.ts';
import { type PushServiceClient, sendPushMessages } from '../_shared/push.ts';

const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN') || undefined;
const secret = Deno.env.get('NEW_MATERIAL_NOTIFY_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleNewMaterialRequest(request, secret, {
    async recipients(type, id) {
      const { data, error } = await supabase.rpc('new_material_recipients', { type, item: id });
      if (error) throw new Error(error.message);
      return (data ?? []) as NewMaterialRecipient[];
    },
    send: (messages) => sendPushMessages(supabase as unknown as PushServiceClient, fetch, messages, { accessToken }),
    log: (line) => console.log(line),
  }),
);
