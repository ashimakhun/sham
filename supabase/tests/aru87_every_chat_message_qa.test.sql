-- QA ARU-87: gaps in aru87_every_chat_message.test.sql: the column's shape (not null, default true), switching General
-- chat off leaves every other switch alone (and the other way round), set_telegram_notification() refusing a null
-- value and anon, empty Vault values skipping the general chat call, the exact headers and timeout, one call per row of
-- a multi-row insert, an update queueing nothing, the trigger's shape, the teacher as author in both chats, and a
-- Pending account with a leftover Telegram link never in the general chat recipients.
-- Fixture (t.seed): course A owned by M; teacher T; mentors M2, N; students S1-S3. S1 is a listener of A. P is Pending.
select t.seed();
create function t.u(name text) returns uuid language sql immutable as $$
  select coalesce(t.id(name), md5('aru87qa-' || name)::uuid)
$$;
grant usage on schema t to service_role;
insert into auth.users (id, email, raw_user_meta_data) values (t.u('P'), 'p87@x.test', '{"full_name":"Pending Pat"}');
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));

create function t.names(ids uuid[]) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '')
  from unnest(array['T', 'M', 'N', 'M2', 'S1', 'S2', 'S3', 'P']) k where t.u(k) = any (ids)
$$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- The column: not null, default true.
select t.ok((select attnotnull from pg_attribute where attrelid = 'telegram_links'::regclass and attname = 'notify_general_chat'),
  'AC6 notify_general_chat is not null');
select t.eq((select pg_get_expr(adbin, adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
  where d.adrelid = 'telegram_links'::regclass and a.attname = 'notify_general_chat'), 'true', 'AC6 default true');

-- Switches are independent of each other.
insert into telegram_links (user_id, chat_id) values (t.id('T'), 4001), (t.u('P'), 4002);
select t.login('T');
select t.lives('select set_telegram_notification(''general_chat'', false)', 'AC6 the teacher turns General chat off');
reset role;
select t.ok((select notify_chat_message and notify_new_account and notify_homework_submitted and notify_meeting_started
  and notify_new_homework and notify_homework_reviewed and not notify_general_chat from telegram_links where user_id = t.id('T')),
  'AC6 every other switch stays on');
select t.login('T');
select t.lives('select set_telegram_notification(''chat_message'', false)', 'the teacher turns Chat messages off');
select t.lives('select set_telegram_notification(''general_chat'', true)', 'and General chat back on');
reset role;
select t.ok((select notify_general_chat and not notify_chat_message from telegram_links where user_id = t.id('T')),
  'AC6 Chat messages and General chat are saved separately');
select t.login('T');
select t.throws('select set_telegram_notification(''general_chat'', null)', '22023', 'a null value is refused');
reset role;
select t.login(null);
select t.throws('select set_telegram_notification(''general_chat'', false)', '42501', 'anon can''t change a switch');
reset role;

-- Recipients: the teacher as author is left out of both; a Pending account with a leftover link never gets the
-- general chat.
insert into general_messages (id, author_id, body) values (t.u('gT'), t.id('T'), 'from the teacher');
insert into course_messages (id, course_id, author_id, body) values (t.u('cT'), t.id('A'), t.id('T'), 'from the teacher');
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select t.eq((select t.names(recipient_ids) from general_message_recipients(t.u('gT'))), 'M,M2,N,S1,S2,S3',
  'AC5 the teacher''s general message: every Approved user but the teacher; not Pending P');
select t.eq((select course_title || ':' || t.names(recipient_ids) from chat_message_recipients(t.u('cT'))), 'Algebra:M,S1',
  'AC3 the teacher''s course message: owner and listener, not the teacher');
reset role;
delete from net.requests;

-- The trigger: after insert, for each row; not on update.
select t.ok((select tgtype & 1 = 1 and tgtype & 4 = 4 and tgtype & 16 = 0 and tgtype & 8 = 0 from pg_trigger
  where tgname = 'general_messages_notify' and tgrelid = 'general_messages'::regclass), 'AC8 after insert, for each row only');

-- Empty Vault values: no call.
insert into vault.decrypted_secrets (name, decrypted_secret) values ('chat_notify_url', ''), ('chat_notify_secret', '');
insert into general_messages (author_id, body) values (t.id('S1'), 'hi');
select t.eq((select count(*) from net.requests), 0::bigint, 'AC7 empty URL and secret: no call');
update vault.decrypted_secrets set decrypted_secret = 'https://x.supabase.co/functions/v1/chat-message-notifications'
  where name = 'chat_notify_url';
insert into general_messages (author_id, body) values (t.id('S1'), 'hi again');
select t.eq((select count(*) from net.requests), 0::bigint, 'AC7 URL set, secret empty: no call');
update vault.decrypted_secrets set decrypted_secret = 'k3y' where name = 'chat_notify_secret';

-- A multi-row insert: one call per row, each with its own id, the JSON content type and 30 s.
insert into general_messages (id, author_id, body) values
  (t.u('g1'), t.id('S1'), 'one'), (t.u('g2'), t.id('S2'), 'two'), (t.u('g3'), t.id('M'), 'three');
select t.eq((select count(*) from net.requests), 3::bigint, 'AC9 three rows: three calls');
select t.eq((select array_agg(body ->> 'general_message_id' order by body ->> 'general_message_id') from net.requests),
  (select array_agg(x::text order by x::text) from unnest(array[t.u('g1'), t.u('g2'), t.u('g3')]) x), 'AC9 each with its own id');
select t.eq((select count(*) from net.requests where headers ->> 'Content-Type' = 'application/json'
  and headers ->> 'Authorization' = 'Bearer k3y' and timeout_milliseconds = 30000), 3::bigint,
  'AC10 JSON content type, bearer secret, 30 s');
select t.ok(not exists (select 1 from net.requests where body ? 'body' or body ? 'author_id' or body::text ~ '(one|two|three)'),
  'privacy: the call carries only the id');

-- An update (only the admin can) queues nothing.
update general_messages set body = 'edited' where id = t.u('g1');
select t.eq((select count(*) from net.requests), 3::bigint, 'AC8 an update queues nothing');
