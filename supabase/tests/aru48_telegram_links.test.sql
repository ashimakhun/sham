-- ARU-48: Telegram links and notification switches. Rules under test: supabase/migrations/0023_telegram_links.sql.
-- Fixture (t.seed): approved T, M, N, M2, S1, S2, S3. P is a new, still pending account.
select t.seed();
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000048a1', 'p@x.test', '{"full_name":"Pending Pat"}');

-- As the bot (the Edge Function uses the service role).
create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant execute on function t.bot() to anon, authenticated, service_role;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
-- The latest code of a user (as the admin).
create function t.code(who text) returns text language sql security definer as $$
  select code from telegram_link_codes where user_id = t.id(who) order by created_at desc, used_at nulls first limit 1
$$;
grant execute on function t.code(text) to anon, authenticated, service_role;
create function t.linked_chat(who text) returns bigint language sql security definer as $$
  select chat_id from telegram_links where user_id = t.id(who)
$$;
grant execute on function t.linked_chat(text) to anon, authenticated, service_role;

-- Data checks.
select t.ok((select relrowsecurity from pg_class where oid = 'public.telegram_links'::regclass), 'data: RLS on telegram_links');
select t.ok((select relrowsecurity from pg_class where oid = 'public.telegram_link_codes'::regclass), 'data: RLS on telegram_link_codes');
select t.ok(not exists (select 1 from pg_publication_tables where tablename = 'telegram_links'), 'data: links are not in realtime');
select t.ok((select bool_and(prosecdef and 'search_path=public' = any(proconfig)) from pg_proc where proname in
  ('create_telegram_link_code', 'set_telegram_notification', 'disconnect_telegram', 'link_telegram_chat', 'unlink_telegram_chat')),
  'data: every function is security definer with search_path = public');

-- AC 1 / AC 9: approved accounts get a code; a pending one and anon don't.
select t.login('S1');
select t.ok(t.code('S1') is null, 'no code before Connect');
select t.ok((select create_telegram_link_code()) ~ '^[A-Za-z0-9_-]{1,64}$', 'AC1 a code is URL-safe and at most 64 characters');
select t.lives($$select create_telegram_link_code()$$, 'tapping Connect again makes a new code');
reset role;
select t.eq((select count(*) from telegram_link_codes where user_id = t.id('S1') and used_at is null), 1::bigint,
  'only the newest unused code is kept');
select t.login(null);
select t.throws($$select create_telegram_link_code()$$, '42501', 'AC9 anon cannot make a code');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000048a1', 'role', 'authenticated')::text, false);
set role authenticated;
select t.throws($$select create_telegram_link_code()$$, '42501', 'AC9 a pending account cannot make a code');
reset role;

-- AC 2: the bot links the chat with the code and gets the name.
select t.bot();
select t.eq((select link_telegram_chat(t.code('S1'), 1001)), 'Student Sam', 'AC2 the bot links S1''s chat and gets the name');
select t.eq(t.linked_chat('S1'), 1001::bigint, 'AC2 the chat is linked');
select t.ok((select notify_meeting_started and notify_new_homework and notify_homework_reviewed and notify_chat_message
  from telegram_links where user_id = t.id('S1')), 'AC5 every switch starts on');

-- AC 3: used, unknown, missing and old codes link nothing.
select t.ok((select link_telegram_chat(t.code('S1'), 1002)) is null, 'AC3 a used code links nothing');
select t.ok((select link_telegram_chat('nope', 1002)) is null, 'AC3 an unknown code links nothing');
select t.ok((select link_telegram_chat(null, 1002)) is null, 'AC3 no code links nothing');
reset role;
select t.login('S2');
select create_telegram_link_code();
reset role;
update telegram_link_codes set created_at = now() - interval '15 minutes 1 second' where user_id = t.id('S2');
select t.bot();
select t.ok((select link_telegram_chat(t.code('S2'), 1003)) is null, 'AC3 a code older than 15 minutes links nothing');
reset role;
update telegram_link_codes set created_at = now() - interval '14 minutes 59 seconds' where user_id = t.id('S2');
select t.bot();
select t.eq((select link_telegram_chat(t.code('S2'), 1003)), 'Student Sue', 'AC2 a code just under 15 minutes old works');
reset role;
select t.eq((select count(*) from telegram_links where chat_id = 1002), 0::bigint, 'AC3 chat 1002 was never linked');

-- AC 9: own row only; no codes; no direct writes.
select t.login('S1');
select t.eq((select count(*) from telegram_links), 1::bigint, 'AC9 a user reads only their own link');
select t.eq((select chat_id from telegram_links), 1001::bigint, 'AC9 their own chat id');
select t.eq((select count(*) from telegram_link_codes), 0::bigint, 'AC9 codes are not readable, not even the own ones');
select t.throws($$insert into telegram_link_codes (code, user_id) values ('mine', auth.uid())$$, '42501', 'AC9 no direct code insert');
select t.throws($$update telegram_link_codes set used_at = null$$, '42501', 'AC9 no direct code update');
select t.throws($$update telegram_links set chat_id = 1 where user_id = auth.uid()$$, '42501', 'AC9 no direct update');
select t.throws($$delete from telegram_links$$, '42501', 'AC9 no direct delete');
select t.throws($$insert into telegram_links (user_id, chat_id) values (auth.uid(), 5)$$, '42501', 'AC9 no direct insert');
select t.throws($$select link_telegram_chat('x', 1)$$, '42501', 'AC9 an app user cannot call the bot''s link function');
select t.throws($$select unlink_telegram_chat(1003)$$, '42501', 'AC9 an app user cannot call the bot''s unlink function');
select t.login('T');
select t.eq((select count(*) from telegram_links), 0::bigint, 'AC9 not even the teacher sees others'' links');
select t.login(null);
select t.eq((select count(*) from telegram_links), 0::bigint, 'AC9 anon reads no links');
select t.eq((select count(*) from telegram_link_codes), 0::bigint, 'AC9 anon reads no codes');
select t.throws($$select set_telegram_notification('chat_message', false)$$, '42501', 'AC9 anon cannot change switches');
select t.throws($$select disconnect_telegram()$$, '42501', 'AC9 anon cannot disconnect');

-- AC 5: switches.
select t.login('S1');
select t.lives($$select set_telegram_notification('chat_message', false)$$, 'AC5 turn chat messages off');
select t.lives($$select set_telegram_notification('new_homework', false)$$, 'AC5 turn new homework off');
select t.lives($$select set_telegram_notification('new_homework', true)$$, 'AC5 and back on');
select t.eq((select notify_chat_message::text || notify_new_homework::text || notify_meeting_started::text from telegram_links),
  'falsetruetrue', 'AC5 each switch is saved separately');
select t.throws($$select set_telegram_notification('bogus', true)$$, '22023', 'AC5 an unknown type is an error');
select t.throws($$select set_telegram_notification('chat_message', null)$$, '22023', 'AC5 on or off is required');
select t.login('S3');
select t.lives($$select set_telegram_notification('chat_message', false)$$, 'AC5 not linked: switching does nothing, no error');
reset role;
select t.eq((select count(*) from telegram_links where user_id = t.id('S3')), 0::bigint, 'AC5 no row is created by a switch');

-- AC 8: relinking keeps one chat per account; a chat moves to the account whose code it uses.
select t.login('S1');
select create_telegram_link_code();
reset role;
select t.bot();
select t.eq((select link_telegram_chat(t.code('S1'), 2001)), 'Student Sam', 'AC8 S1 connects from a new Telegram account');
reset role;
select t.eq(t.linked_chat('S1'), 2001::bigint, 'AC8 the new chat replaces the old one');
select t.eq((select count(*) from telegram_links where chat_id = 1001), 0::bigint, 'AC8 the old chat is no longer linked');
select t.ok(not (select notify_chat_message from telegram_links where user_id = t.id('S1')), 'AC8 relinking keeps the switches');
select t.login('M');
select create_telegram_link_code();
reset role;
select t.bot();
select t.eq((select link_telegram_chat(t.code('M'), 2001)), 'Mentor Max', 'AC8 S1''s chat uses M''s code');
reset role;
select t.eq(t.linked_chat('M'), 2001::bigint, 'AC8 the chat moves to M');
select t.ok(t.linked_chat('S1') is null, 'AC8 S1 is no longer connected');

-- AC 6 / AC 7: disconnecting.
select t.login('M');
select t.lives($$select disconnect_telegram()$$, 'AC6 M disconnects in the app');
select t.eq((select count(*) from telegram_links), 0::bigint, 'AC6 the link and switches are gone');
select t.lives($$select disconnect_telegram()$$, 'AC6 disconnecting again is no error');
select t.bot();
select t.lives($$select unlink_telegram_chat(1003)$$, 'AC7 /stop unlinks S2''s chat');
select t.lives($$select unlink_telegram_chat(9999)$$, 'AC7 /stop from a chat that isn''t linked is no error');
reset role;
select t.ok(t.linked_chat('S2') is null, 'AC7 S2 is disconnected');

-- Deleted account: link and codes go with it.
select t.login('S3');
select create_telegram_link_code();
reset role;
select t.bot();
select link_telegram_chat(t.code('S3'), 3001);
reset role;
delete from auth.users where id = t.id('S3');
select t.ok(not exists (select 1 from telegram_links where chat_id = 3001), 'deleting an account deletes its link');
select t.ok(not exists (select 1 from telegram_link_codes where user_id = t.id('S3')), 'and its codes');
