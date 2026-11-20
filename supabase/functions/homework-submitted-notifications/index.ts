// ARU-89: a push notification to a course's owner when a listener submits homework. Called by the trigger from
// migration 0045 (through pg_net, with "Authorization: Bearer <secret>" and {"homework_id": "<id>"}). The logic is in
// ../_shared/homework-submitted.ts (tested with Jest); this file only wires it to Supabase and push.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   EXPO_ACCESS_TOKEN               optional (ARU-166): only if push security is turned on in Expo. The function sends push (ARU-166).
//   HOMEWORK_SUBMITTED_NOTIFY_SECRET  a random string; the same value goes into Vault as 'homework_submitted_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the trigger sends the shared secret, not a Supabase JWT):
//   npx supabase functions deploy homework-submitted-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleHomeworkSubmittedRequest, type HomeworkSubmittedRecipient } from '../_shared/homework-submitted.ts';
import { type PushServiceClient, sendPushMessages } from '../_shared/push.ts';

const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN') || undefined;
const secret = Deno.env.get('HOMEWORK_SUBMITTED_NOTIFY_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleHomeworkSubmittedRequest(request, secret, {
    async recipient(homeworkId) {
      const { data, error } = await supabase.rpc('homework_submitted_recipient', { homework: homeworkId });
      if (error) throw new Error(error.message);
      return (data ?? []) as HomeworkSubmittedRecipient[];
    },
    send: (messages) => sendPushMessages(supabase as unknown as PushServiceClient, fetch, messages, { accessToken }),
    log: (line) => console.log(line),
  }),
);
