// ARU-44: a Telegram message "New message in the <course title> chat" when someone else writes in a course chat.
// Called through pg_net by the after-insert trigger on course_messages (migration 0036), with the message id and
// `Authorization: Bearer <CHAT_NOTIFY_SECRET>`. The logic is in ../_shared/chat-message.ts (tested with Jest); this file
// only wires it to Supabase and Telegram.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   TELEGRAM_BOT_TOKEN  the bot's token (already set for ARU-48)
//   CHAT_NOTIFY_SECRET  a random string; the same value goes into Vault as 'chat_notify_secret'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification (the trigger sends the secret, not a Supabase JWT):
//   npx supabase functions deploy chat-message-notifications --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

import { type ChatMessageRecipients, handleChatMessageRequest } from '../_shared/chat-message.ts';
import { sendTelegramMessages, type ServiceClient } from '../_shared/telegram.ts';

const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const secret = Deno.env.get('CHAT_NOTIFY_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleChatMessageRequest(request, secret, {
    async recipients(messageId) {
      const { data, error } = await supabase.rpc('chat_message_recipients', { message: messageId });
      if (error) throw new Error(error.message);
      return ((data ?? []) as ChatMessageRecipients[])[0] ?? null;
    },
    send: (messages) => sendTelegramMessages(supabase as unknown as ServiceClient, token, fetch, messages),
    log: (line) => console.log(line),
  }),
);
