// ARU-44: a Telegram message "New message in the <course title> chat" when someone else writes in a course chat; since
// ARU-87 (0046) for every message, and also "New message in the general chat" for the general chat. Called through
// pg_net by the after-insert triggers on course_messages (0036, {"message_id"}) and general_messages (0046,
// {"general_message_id"}), with `Authorization: Bearer <CHAT_NOTIFY_SECRET>`. The logic is in ../_shared/chat-message.ts (tested with Jest); this file
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

import {
  type ChatMessageRecipients,
  type GeneralMessageRecipients,
  handleChatMessageRequest,
} from '../_shared/chat-message.ts';
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
    async generalRecipients(messageId) {
      const { data, error } = await supabase.rpc('general_message_recipients', { message: messageId });
      if (error) throw new Error(error.message);
      return ((data ?? []) as GeneralMessageRecipients[])[0] ?? null;
    },
    send: (messages) => sendTelegramMessages(supabase as unknown as ServiceClient, token, fetch, messages),
    log: (line) => console.log(line),
  }),
);
