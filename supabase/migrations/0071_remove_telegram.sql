-- ARU-171: notifications on the phone, part 3. Removes Telegram completely. Since ARU-166 (0069) every notification is
-- sent as push and nothing reads Telegram data any more, so this deletes it:
--   * telegram_links (every stored chat ID and its notify_* switches) and telegram_link_codes (every link code).
--     Dropping a table drops its policies, indexes, constraints and triggers (the 0059 workspace guard included).
--   * the five Telegram functions: create_telegram_link_code(), set_telegram_notification(), disconnect_telegram()
--     (the app's), link_telegram_chat() and unlink_telegram_chat() (the bot webhook's).
-- notification_settings is not touched: 0069 already copied each account's Telegram switches into it (AC 3). After
-- this no function in public mentions either table (checked by supabase/tests/aru171_remove_telegram.test.sql).
-- The error code db.telegram_not_accepted stays in the app's catalogs: error codes are permanent IDs (ARU-111).

-- 1. The functions first, so nothing can use the tables while they go.
drop function if exists create_telegram_link_code();
drop function if exists set_telegram_notification(text, boolean);
drop function if exists disconnect_telegram();
drop function if exists link_telegram_chat(text, bigint);
drop function if exists unlink_telegram_chat(bigint);

-- 2. The tables, with every chat ID and link code in them.
drop table if exists telegram_link_codes;
drop table if exists telegram_links;
