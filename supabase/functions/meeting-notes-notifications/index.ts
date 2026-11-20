// ARU-151: a push notification to the course when someone publishes meeting notes. Called by the trigger from
// migration 0062 (through pg_net, with "Authorization: Bearer <secret>" and {"id": "<note id>"}). The logic is in
// ../_shared/meeting-notes.ts (tested with Jest); this file only wires it to Supabase and push.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   EXPO_ACCESS_TOKEN          optional (ARU-166): only if push security is turned on in Expo. The function sends push (ARU-166).
//   MEETING_NOTES_NOTIFY_SECRET  a random string; the same value goes into Vault as 'meeting_notes_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the trigger sends the shared secret, not a Supabase JWT):
//   npx supabase functions deploy meeting-notes-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleMeetingNotesRequest, type MeetingNotesRecipient } from '../_shared/meeting-notes.ts';
import { type PushServiceClient, sendPushMessages } from '../_shared/push.ts';

const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN') || undefined;
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
    send: (messages) => sendPushMessages(supabase as unknown as PushServiceClient, fetch, messages, { accessToken }),
    log: (line) => console.log(line),
  }),
);
