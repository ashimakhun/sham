-- QA ARU-44: gaps in aru44_chat_message_notifications.test.sql: a hidden course's chat, a Pending second teacher,
-- the owner as author, a read position in another course, an owner who is also listed as a listener (counted once), a
-- message deleted before processing, empty Vault values, a multi-row insert, an update, the general chat (one call
-- since ARU-87), and the function's search_path / security definer settings.
-- Fixture (t.seed): course A owned by M, B by N; teacher T. Added: H (hidden, owner M2, listener S2), a Pending
-- teacher TP (0009 allows one teacher, so the unique index is dropped as in the dev test).
select t.seed();

create function t.u(name text) returns uuid language sql immutable as $$
  select coalesce(t.id(name), md5('aru44qa-' || name)::uuid)
$$;
grant usage on schema t to service_role;

insert into auth.users (id, email, raw_user_meta_data) values (t.u('TP'), 'tp@x.test', '{"full_name":"Teacher Pending"}');
drop index profiles_one_teacher;
set session_replication_role = replica;
update profiles set role = 'teacher', access_status = 'pending' where id = t.u('TP');
set session_replication_role = origin;

insert into courses (id, title, created_by, hidden) values (t.u('H'), 'Hidden lab', t.id('M2'), true);
insert into course_members (course_id, user_id, added_by) values
  (t.u('H'), t.id('S2'), t.id('M2')),
  (t.id('A'), t.id('S1'), t.id('M'));

create function t.post(name text, course text, author text, ago interval) returns void
  language sql security definer as $$
  insert into course_messages (id, course_id, author_id, body, created_at)
  values (t.u(name), t.u(course), t.u(author), 'Body of ' || name, now() - ago)
$$;
create function t.rcpt(msg text) returns text language sql as $$
  select coalesce((
    select r.course_title || ':' || coalesce((
      select string_agg(k, ',' order by k)
      from unnest(array['M', 'N', 'M2', 'S1', 'S2', 'S3', 'T', 'TP']) k
      where t.u(k) = any (r.recipient_ids)), '')
    from chat_message_recipients(t.u(msg)) r), '')
$$;
create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- Function settings: both security definer with a fixed search_path (no search_path hijack from the caller).
select t.ok((select prosecdef and proconfig @> array['search_path=public'] from pg_proc
  where oid = 'chat_message_recipients(uuid)'::regprocedure), 'chat_message_recipients: security definer, search_path=public');
select t.ok((select prosecdef and proconfig @> array['search_path=public'] from pg_proc
  where oid = 'notify_chat_message()'::regprocedure), 'notify_chat_message: security definer, search_path=public');
select t.ok((select tgtype & 1 = 1 and tgtype & 4 = 4 and tgtype & 16 = 0 from pg_trigger
  where tgname = 'course_messages_notify'), 'trigger is FOR EACH ROW AFTER INSERT only (not on update)');

-- AC 6 hidden course: owner M2 and listener S2 and the (approved) teacher T; not outsiders, not the Pending teacher.
select t.post('h1', 'H', 'S2', interval '2 hours');
select t.bot();
select t.eq(t.rcpt('h1'), 'Hidden lab:M2,T', 'AC6 hidden course: owner and teacher; author S2, outsiders and Pending teacher TP left out');
reset role;

-- The owner writes: the owner is left out, the listener and the teacher are in.
select t.post('a1', 'A', 'M', interval '90 minutes');
select t.bot();
select t.eq(t.rcpt('a1'), 'Algebra:S1,T', 'AC2 owner as author: left out; listener S1 and teacher T in');
reset role;

-- A read position in another course doesn't count for this one: S2 read H just now, but that has nothing to do with A.
insert into course_chat_reads (course_id, user_id, last_read_at) values (t.u('H'), t.id('S2'), now());
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S2'), t.id('M'));
select t.bot();
select t.eq(t.rcpt('a1'), 'Algebra:S1,S2,T', 'AC4 read position in another course ignored: S2 (new listener of A) in');
reset role;

-- The owner also listed as a listener (data from before ARU-9 rules): one entry, not two.
insert into course_members (course_id, user_id, added_by) values (t.u('H'), t.id('M2'), t.id('M2'));
select t.bot();
select t.eq((select cardinality(recipient_ids) from chat_message_recipients(t.u('h1'))), 2,
  'owner who is also a listener is counted once');
reset role;

-- A message gone before processing (its course deleted, cascade): no row, so the function sends nothing.
insert into courses (id, title, created_by) values (t.u('G'), 'Gone', t.id('M'));
select t.post('g1', 'G', 'M', interval '1 hour');
delete from courses where id = t.u('G');
select t.bot();
select t.eq(t.rcpt('g1'), '', 'message deleted before processing: no row');
reset role;

-- No call queued so far (no Vault secrets).
select t.eq((select count(*) from net.requests), 0::bigint, 'AC7 no Vault secrets: nothing queued');

-- Empty strings in Vault are treated as missing.
insert into vault.decrypted_secrets (name, decrypted_secret) values ('chat_notify_url', ''), ('chat_notify_secret', '');
select t.post('e1', 'A', 'S1', interval '50 minutes');
select t.eq((select count(*) from net.requests), 0::bigint, 'AC8 empty URL and secret: no call');
update vault.decrypted_secrets set decrypted_secret = 'https://x.supabase.co/functions/v1/chat-message-notifications'
  where name = 'chat_notify_url';
select t.post('e2', 'A', 'S1', interval '49 minutes');
select t.eq((select count(*) from net.requests), 0::bigint, 'AC8 URL set, secret empty: no call');
update vault.decrypted_secrets set decrypted_secret = 'k3y' where name = 'chat_notify_secret';

-- A multi-row insert: one call per message, each with its own id.
insert into course_messages (id, course_id, author_id, body) values
  (t.u('r1'), t.id('A'), t.id('S1'), 'one'),
  (t.u('r2'), t.id('A'), t.id('S1'), 'two'),
  (t.u('r3'), t.id('A'), t.id('M'), 'three');
select t.eq((select count(*) from net.requests), 3::bigint, 'AC8 three rows in one insert: three calls');
select t.eq((select array_agg(body ->> 'message_id' order by body ->> 'message_id') from net.requests),
  (select array_agg(x::text order by x::text) from unnest(array[t.u('r1'), t.u('r2'), t.u('r3')]) x),
  'AC8 each call carries its own message id');
select t.eq((select count(*) from net.requests where headers ->> 'Authorization' = 'Bearer k3y'
  and headers ->> 'Content-Type' = 'application/json' and timeout_milliseconds = 30000), 3::bigint,
  'AC8 each call: bearer secret, JSON content type, 30 s timeout');

-- An update (only the admin can) queues nothing. ARU-87 (0046): a general chat message now queues one call too.
update course_messages set body = 'edited' where id = t.u('r1');
insert into general_messages (author_id, body) values (t.id('S1'), 'hello everyone');
select t.eq((select count(*) from net.requests), 4::bigint, 'an update queues nothing; a general chat message queues one call (ARU-87)');

-- No call body or header carries the chat text or the author.
select t.ok(not exists (select 1 from net.requests where body::text ~ '(one|two|three)' or body ? 'author_id'
  or body ? 'body'), 'AC1 privacy: the call has only the message id');
