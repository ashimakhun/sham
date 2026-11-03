-- ARU-87: every chat message notifies. chat_message_recipients() without read positions, general_message_recipients(),
-- the General chat switch and the after-insert trigger on general_messages.
-- Rules under test: supabase/migrations/0046_every_chat_message_notifications.sql.
-- Fixture (t.seed): course A owned by M, B by N; teacher T; mentors M2, N; students S1-S3. Here: S1 and S2 are
-- listeners of A; P (Pending) and R (Rejected) are extra accounts. Ids: md5('aru87-' || name).
select t.seed();
create function t.u(name text) returns uuid language sql immutable as $$
  select coalesce(t.id(name), md5('aru87-' || name)::uuid)
$$;
grant usage on schema t to service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  (t.u('P'), 'p@x.test', '{"full_name":"Pending Pat"}'),
  (t.u('R'), 'r@x.test', '{"full_name":"Rejected Rob"}');
update profiles set access_status = 'rejected' where id = t.u('R');
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M'));

create function t.names(ids uuid[]) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '')
  from unnest(array['T', 'M', 'N', 'M2', 'S1', 'S2', 'S3', 'P', 'R']) k where t.u(k) = any (ids)
$$;
create function t.course(msg text) returns text language sql as $$
  select coalesce((select r.course_title || ':' || t.names(r.recipient_ids) from chat_message_recipients(t.u(msg)) r), '-')
$$;
create function t.general(msg text) returns text language sql as $$
  select coalesce((select t.names(r.recipient_ids) from general_message_recipients(t.u(msg)) r), '-')
$$;
create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- AC 10: grants and function settings.
select t.ok(not has_function_privilege('anon', 'general_message_recipients(uuid)', 'execute'), 'anon can''t run general_message_recipients');
select t.ok(not has_function_privilege('authenticated', 'general_message_recipients(uuid)', 'execute'), 'app users can''t run it');
select t.ok(has_function_privilege('service_role', 'general_message_recipients(uuid)', 'execute'), 'the service role can');
select t.ok(not has_function_privilege('authenticated', 'chat_message_recipients(uuid)', 'execute')
  and has_function_privilege('service_role', 'chat_message_recipients(uuid)', 'execute'), 'chat_message_recipients grants kept');
select t.ok(not has_function_privilege('anon', 'notify_general_message()', 'execute')
  and not has_function_privilege('authenticated', 'notify_general_message()', 'execute'), 'trigger function not executable by app users');
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc
  where oid = 'general_message_recipients(uuid)'::regprocedure), 'general_message_recipients: security definer, search_path=public');
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc
  where oid = 'notify_general_message()'::regprocedure), 'notify_general_message: security definer, search_path=public');

-- AC 6: the switch.
insert into telegram_links (user_id, chat_id) values (t.id('S1'), 3001), (t.id('T'), 3002);
select t.ok((select bool_and(notify_general_chat) from telegram_links), 'AC6 on by default');
select t.login('S1');
select t.lives('select set_telegram_notification(''general_chat'', false)', 'AC6 S1 turns General chat off');
reset role;
select t.ok(not (select notify_general_chat from telegram_links where user_id = t.id('S1')), 'AC6 saved off');
select t.ok((select notify_chat_message from telegram_links where user_id = t.id('S1')), 'AC6 Chat messages untouched');
select t.ok((select notify_general_chat from telegram_links where user_id = t.id('T')), 'AC6 only the caller''s row');
select t.login('T');
select t.lives('select set_telegram_notification(''new_account'', false)', 'ARU-84 kind kept');
select t.lives('select set_telegram_notification(''homework_submitted'', false)', 'ARU-89 kind kept');
select t.lives('select set_telegram_notification(''chat_message'', true)', 'earlier kinds kept');
select t.throws('select set_telegram_notification(''nope'', true)', '22023', 'unknown kind still an error');
reset role;

-- AC 1 / AC 2: course chat, every message, read positions ignored. S1 hasn't opened A for a day and has 3 unread
-- messages from others; a 4th arrives -> S1 is a recipient (the 3 Nov case).
insert into course_chat_reads (course_id, user_id, last_read_at) values (t.id('A'), t.id('S1'), now() - interval '1 day');
insert into course_messages (id, course_id, author_id, body, created_at) values
  (t.u('c1'), t.id('A'), t.id('M'), 'one', now() - interval '4 hours'),
  (t.u('c2'), t.id('A'), t.id('T'), 'two', now() - interval '3 hours'),
  (t.u('c3'), t.id('A'), t.id('S2'), 'three', now() - interval '2 hours'),
  (t.u('c4'), t.id('A'), t.id('T'), 'four', now() - interval '1 hour');
select t.bot();
select t.eq(t.course('c4'), 'Algebra:M,S1,S2', 'AC2 4th message with 3 unread: S1 included; owner, listeners; not the author');
select t.eq(t.course('c1'), 'Algebra:S1,S2,T', 'AC1 every message: c1 to everyone but its author');
select t.eq(t.course('c3'), 'Algebra:M,S1,T', 'AC1 c3 too');
reset role;
-- After S1 reads up to c4, the next one still notifies (and so would one before).
update course_chat_reads set last_read_at = now() where course_id = t.id('A') and user_id = t.id('S1');
select t.bot();
select t.eq(t.course('c2'), 'Algebra:M,S1,S2', 'AC2 a read position after the message changes nothing');
reset role;

-- AC 3: still excluded: non-members, Pending / Rejected; hidden course same rule; removed listener.
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.u('P'), t.id('M')), (t.id('A'), t.u('R'), t.id('M'));
update profiles set access_status = 'pending' where id = t.u('P');
update courses set hidden = true where id = t.id('A');
delete from course_members where course_id = t.id('A') and user_id = t.id('S2');
select t.bot();
select t.eq(t.course('c4'), 'Algebra:M,S1', 'AC3 hidden course; S2 removed; Pending P, Rejected R, outsiders N, M2, S3 left out');
select t.eq(t.course('nope'), '-', 'unknown course message: no row');
reset role;

-- AC 4 / AC 5: general chat recipients = every Approved user but the author.
insert into general_messages (id, author_id, body) values (t.u('g0'), t.id('S1'), 'before secrets');
select t.bot();
select t.eq(t.general('g0'), 'M,M2,N,S2,S3,T', 'AC5 everyone Approved but the author; not P or R');
select t.eq(t.general('nope'), '-', 'AC10 unknown general message: no row');
reset role;

-- AC 7: no Vault secrets -> posting works, no call.
select t.login('S2');
select t.lives(format('insert into general_messages (id, author_id, body) values (%L, %L, %L)', t.u('g1'), t.id('S2'), 'hi'),
  'AC7 S2 posts in the general chat with no secrets');
reset role;
select t.eq((select count(*) from net.requests), 0::bigint, 'AC7 no secrets: no call');

-- AC 9 / AC 10: with secrets, exactly one call per post, with the id and the header; same Vault names as course chats.
insert into vault.decrypted_secrets values
  ('chat_notify_url', 'https://x.supabase.co/functions/v1/chat-message-notifications'),
  ('chat_notify_secret', 's3cret');
select t.login('S2');
select t.lives(format('insert into general_messages (id, author_id, body) values (%L, %L, %L)', t.u('g2'), t.id('S2'), 'one'),
  'S2 posts');
reset role;
select t.eq((select count(*) from net.requests), 1::bigint, 'AC10 exactly one call');
select t.eq((select body from net.requests order by id desc limit 1), jsonb_build_object('general_message_id', t.u('g2')),
  'body is {"general_message_id": "<id>"}');
select t.eq((select headers ->> 'Authorization' from net.requests order by id desc limit 1), 'Bearer s3cret', 'Bearer <secret>');
select t.eq((select url from net.requests order by id desc limit 1), 'https://x.supabase.co/functions/v1/chat-message-notifications',
  'the same function as course chats');
select t.eq((select params from net.requests order by id desc limit 1), '{}'::jsonb, 'named arguments: no query params');
select t.ok((select timeout_milliseconds from net.requests order by id desc limit 1) > 0, 'explicit timeout');

-- AC 9: five posts in a row -> five calls. A retry with the same id is refused and queues nothing.
select t.login('S1');
select t.lives(format('insert into general_messages (id, author_id, body) values (%L, %L, ''a'')', t.u('g3'), t.id('S1')), 'g3');
select t.lives(format('insert into general_messages (id, author_id, body) values (%L, %L, ''b'')', t.u('g4'), t.id('S1')), 'g4');
select t.lives(format('insert into general_messages (id, author_id, body) values (%L, %L, ''c'')', t.u('g5'), t.id('S1')), 'g5');
select t.lives(format('insert into general_messages (id, author_id, body) values (%L, %L, ''d'')', t.u('g6'), t.id('S1')), 'g6');
select t.lives(format('insert into general_messages (id, author_id, body) values (%L, %L, ''e'')', t.u('g7'), t.id('S1')), 'g7');
select t.throws(format('insert into general_messages (id, author_id, body) values (%L, %L, ''e'')', t.u('g7'), t.id('S1')),
  '23505', 'AC9 a retried post with the same id is refused');
reset role;
select t.eq((select count(*) from net.requests), 6::bigint, 'AC9 one call per message, none for the retry');

-- Course chat trigger still queues one per message (unchanged 0036 trigger).
select t.login('S1');
select t.lives(format('insert into course_messages (id, course_id, author_id, body) values (%L, %L, %L, ''x'')',
  t.u('c5'), t.id('A'), t.id('S1')), 'S1 posts in A');
reset role;
select t.eq((select body from net.requests order by id desc limit 1), jsonb_build_object('message_id', t.u('c5')),
  'course chat call unchanged: {"message_id"}');

-- AC 7: net.http_post raising -> posting still works.
create or replace function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000
) returns bigint language plpgsql as $$ begin raise exception 'pg_net is down'; end $$;
select t.login('S1');
select t.lives(format('insert into general_messages (id, author_id, body) values (%L, %L, ''z'')', t.u('g8'), t.id('S1')),
  'AC7 posting works when net.http_post raises');
reset role;
select t.ok(exists (select 1 from general_messages where id = t.u('g8')), 'AC7 and the message is there');

-- AC 7: no pg_net, no Vault -> still works.
drop schema net cascade;
drop schema vault cascade;
select t.login('S1');
select t.lives(format('insert into general_messages (id, author_id, body) values (%L, %L, ''y'')', t.u('g9'), t.id('S1')),
  'AC7 posting works without pg_net and Vault');
reset role;

select t.ok(not exists (select 1 from pg_policies where tablename = 'general_messages' and cmd in ('UPDATE', 'DELETE')),
  'AC8 general messages still can''t be edited or deleted (no new policy)');
