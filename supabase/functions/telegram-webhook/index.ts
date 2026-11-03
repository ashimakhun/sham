// The Sham Telegram bot's webhook (ARU-48): links a private chat to a Sham account (/start <code>) and unlinks it
// (/stop). The logic is in ../_shared/telegram-bot.ts (tested with Jest); this file only wires it to Supabase.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set ...`):
//   TELEGRAM_BOT_TOKEN       the token @BotFather gave for the bot
//   TELEGRAM_WEBHOOK_SECRET  a random string ([A-Za-z0-9_-], up to 256 characters); the same one goes to setWebhook
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy without JWT verification, because Telegram does not send a Supabase JWT (the secret header protects it):
//   npx supabase functions deploy telegram-webhook --no-verify-jwt
// Then point the bot at it once (see README → Telegram notifications):
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<function URL>&secret_token=<TELEGRAM_WEBHOOK_SECRET>&allowed_updates=["message"]

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleTelegramWebhook } from '../_shared/telegram-bot.ts';
import { sendTelegramText } from '../_shared/telegram.ts';

const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleTelegramWebhook(request, secret, {
    async linkChat(code, chatId) {
      const { data, error } = await supabase.rpc('link_telegram_chat', { code, chat_id: chatId });
      if (error) throw new Error(error.message);
      return (data as string | null) ?? null;
    },
    async unlinkChat(chatId) {
      const { error } = await supabase.rpc('unlink_telegram_chat', { chat_id: chatId });
      if (error) throw new Error(error.message);
    },
    reply: (chatId, text) => sendTelegramText(fetch, token, chatId, text),
    log: (message) => console.error(message),
  }),
);
