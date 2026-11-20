// ARU-49: a push notification to a homework's sender when it is checked. Called by the trigger from migration 0037
// (through pg_net, with "Authorization: Bearer <secret>" and {"homework_id": "<id>"}). The logic is in
// ../_shared/homework-reviewed.ts (tested with Jest); this file only wires it to Supabase and push.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   EXPO_ACCESS_TOKEN              optional (ARU-166): only if push security is turned on in Expo. The function sends push (ARU-166).
//   HOMEWORK_REVIEWED_NOTIFY_SECRET  a random string; the same value goes into Vault as 'homework_reviewed_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the trigger sends the shared secret, not a Supabase JWT):
//   npx supabase functions deploy homework-reviewed-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleHomeworkReviewedRequest, type HomeworkRecipient } from '../_shared/homework-reviewed.ts';
import { type PushServiceClient, sendPushMessages } from '../_shared/push.ts';

const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN') || undefined;
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
    send: (messages) => sendPushMessages(supabase as unknown as PushServiceClient, fetch, messages, { accessToken }),
    log: (line) => console.log(line),
  }),
);
