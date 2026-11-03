-- ARU-44: chat_message_recipients() and the after-insert trigger that queues the Edge Function call.
-- Rules under test: supabase/migrations/0036_chat_message_notifications.sql.
-- Fixture (t.seed): course A owned by mentor M, B by mentor N; teacher T. Added here: a second teacher T2 (0009 allows
-- only one, so this test database drops that rule's index and trigger for T2: AC 6 says "the teacher" means every
-- Approved teacher, so the function must not assume there is just one), and students P
-- (Pending), R (Rejected) and X (removed listener). Listeners of A: S1 (student), M2 (mentor), S3 (no read position),
-- P, R; X was one. N and S2 are not in A. Messages are posted as the admin with times in the past.
select t.seed();

-- Ids: fixture names through t.id(), everything else from md5('aru44-' || name).
create function t.u(name text) returns uuid language sql immutable as $$
  select coalesce(t.id(name), md5('aru44-' || name)::uuid)
$$;
grant execute on function t.u(text) to anon, authenticated, service_role;
grant usage on schema t to service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  (t.u('T2'), 't2@x.test', '{"full_name":"Teacher Two"}'),
  (t.u('P'),  'p@x.test',  '{"full_name":"Pending Pat"}'),
  (t.u('R'),  'r@x.test',  '{"full_name":"Rejected Rob"}'),
  (t.u('X'),  'x@x.test',  '{"full_name":"Removed Rex"}');
update profiles set access_status = 'approved' where id in (t.u('X'), t.u('P'), t.u('R'));
drop index profiles_one_teacher;
set session_replication_role = replica;
update profiles set role = 'teacher', access_status = 'approved' where id = t.u('T2');
set session_replication_role = origin;

insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M')),
  (t.id('A'), t.u('P'), t.id('M')),
  (t.id('A'), t.u('R'), t.id('M')),
  (t.id('A'), t.u('X'), t.id('M'));
update profiles set access_status = 'pending' where id = t.u('P');
update profiles set access_status = 'rejected' where id = t.u('R');

-- Everyone but S3 has read A up to 10 hours ago (outsiders N and S2 too, to show a position alone gives nothing).
insert into course_chat_reads (course_id, user_id, last_read_at)
  select t.id('A'), t.u(k), now() - interval '10 hours'
  from unnest(array['M', 'S1', 'M2', 'T', 'T2', 'P', 'R', 'X', 'N', 'S2']) k;

-- A message posted as the admin: t.post(name, course, author, ago).
create function t.post(name text, course text, author text, ago interval) returns void
  language sql security definer as $$
  insert into course_messages (id, course_id, author_id, body, created_at)
  values (t.u(name), t.u(course), t.u(author), 'Body of ' || name, now() - ago)
$$;
-- chat_message_recipients() as "title:name,name" (names are the keys above, sorted); '' for no row.
create function t.rcpt(msg text) returns text language sql as $$
  select coalesce((
    select r.course_title || ':' || coalesce((
      select string_agg(k, ',' order by k)
      from unnest(array['M', 'N', 'M2', 'S1', 'S2', 'S3', 'T', 'T2', 'P', 'R', 'X']) k
      where t.u(k) = any (r.recipient_ids)), '')
    from chat_message_recipients(t.u(msg)) r), '')
$$;
create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- AC 9: who can run it.
select t.ok(not has_function_privilege('anon', 'chat_message_recipients(uuid)', 'execute'), 'AC9 anon can''t run chat_message_recipients');
select t.ok(not has_function_privilege('authenticated', 'chat_message_recipients(uuid)', 'execute'), 'AC9 app users can''t run it');
select t.ok(has_function_privilege('service_role', 'chat_message_recipients(uuid)', 'execute'), 'AC9 the service role can');
select t.ok(not has_function_privilege('anon', 'notify_chat_message()', 'execute'), 'AC8 anon can''t run the trigger function');
select t.ok(not has_function_privilege('authenticated', 'notify_chat_message()', 'execute'), 'AC8 app users can''t run the trigger function');
select t.ok(exists (select 1 from pg_trigger where tgname = 'course_messages_notify'
  and tgrelid = 'course_messages'::regclass and not tgisinternal), 'AC8 after-insert trigger on course_messages');

-- X is removed before the first message is processed.
delete from course_members where course_id = t.id('A') and user_id = t.u('X');

-- m1 by S1: the first message in A.
select t.post('m1', 'A', 'S1', interval '9 hours');
select t.login('S1');
select t.throws($$select * from chat_message_recipients('$$ || t.u('m1') || $$')$$, '42501', 'AC9 a participant calling it is refused');
reset role; select t.login(null);
select t.throws($$select * from chat_message_recipients('$$ || t.u('m1') || $$')$$, '42501', 'AC9 anon calling it is refused');
reset role;

select t.bot();
select t.eq(t.rcpt('m1'), 'Algebra:M,M2,S3,T,T2',
  'AC1/2/6 m1: owner, listeners, no-position listener S3 and both teachers; not the author S1, P, R, removed X, N or S2');
select t.eq(t.rcpt('nope'), '', 'AC9 unknown message id: no row');
select t.eq((select count(*) from chat_message_recipients(t.u('nope'))), 0::bigint, 'AC9 unknown message id: empty result');
reset role;

-- AC 3 / AC 4: m2 by M2. S1's only earlier new message is their own, so m2 is S1's oldest new one; everyone else
-- already has m1 unread (S3 too: no read position, and m1 is from someone else).
select t.post('m2', 'A', 'M2', interval '8 hours');
select t.bot();
select t.eq(t.rcpt('m2'), 'Algebra:S1', 'AC3 m2: only S1 (own earlier message doesn''t count); older unread m1 leaves the others out');
select t.eq(t.rcpt('m1'), 'Algebra:M,M2,S3,T,T2', 'AC3 m1 is still the oldest new message for them');
reset role;

-- AC 3: M opens the chat (read up to m2), then S1 posts m3: M is notified again; the others still have m1 unread.
select t.login('M');
select t.lives($$select mark_chat_read('$$ || t.id('A') || $$', '$$ || t.u('m2') || $$')$$, 'AC3 M opens the chat');
reset role;
select t.post('m3', 'A', 'S1', interval '7 hours');
select t.bot();
select t.eq(t.rcpt('m3'), 'Algebra:M', 'AC3 after mark_chat_read: M included again for m3');
select t.eq(t.rcpt('m1'), 'Algebra:M2,S3,T,T2', 'AC3 m1 no longer for M (read)');
reset role;

-- AC (c): m4 by M. T2's position equals m4's time (already read); T's is just before it.
select t.post('m4', 'A', 'M', interval '6 hours');
update course_chat_reads set last_read_at = (select created_at from course_messages where id = t.u('m4'))
  where course_id = t.id('A') and user_id = t.u('T2');
update course_chat_reads set last_read_at = (select created_at from course_messages where id = t.u('m4')) - interval '1 second'
  where course_id = t.id('A') and user_id = t.id('T');
select t.bot();
select t.eq(t.rcpt('m4'), 'Algebra:T', 'AC rule (c): position equal to T leaves T2 out; T (position just before) is in');
reset role;

-- AC 4: S3 has no read position: only the first message from others (m1) counts; after opening the chat once, the
-- next one notifies again.
select t.login('S3');
select t.lives($$select mark_chat_read('$$ || t.id('A') || $$', '$$ || t.u('m4') || $$')$$, 'AC4 S3 opens the chat once');
reset role;
select t.post('m5', 'A', 'M2', interval '5 hours');
select t.bot();
select t.eq(t.rcpt('m5'), 'Algebra:S3,T2',
  'AC4 m5: S3 again after reading once; T2 (read up to m4); M (m3 unread), S1 (m2 unread) and T (m4 unread) left out');
reset role;

-- AC 6: removal before processing; Pending / Rejected never; a course rename shows the title at processing time.
delete from course_members where course_id = t.id('A') and user_id = t.id('S3');
update courses set title = 'Algebra *2* <new>' where id = t.id('A');
select t.bot();
select t.eq(t.rcpt('m5'), 'Algebra *2* <new>:T2', 'AC6 S3 removed before processing: left out; new title used');
reset role;

-- AC 6: ownership moves away. B (owner N): message by T. N is in; after B moves to M2, N is out and M2 (no position:
-- b1 is the first message from others) is in.
select t.post('b1', 'B', 'T', interval '3 hours');
select t.bot();
select t.eq(t.rcpt('b1'), 'Biology:N,T2', 'AC6 b1: owner N and the other teacher');
reset role;
update courses set created_by = t.id('M2') where id = t.id('B');
select t.bot();
select t.eq(t.rcpt('b1'), 'Biology:M2,T2', 'AC6 ownership moved: N out, new owner M2 in');
reset role;

-- AC 10: course C (owner M2, listeners S1 and S2, teachers T and T2), everyone read up to 5 hours ago. S1 and S2 post
-- at the same instant (ordered by id), both saved before either call.
insert into courses (id, title, created_by) values (t.u('C'), 'Chemistry', t.id('M2'));
insert into course_members (course_id, user_id, added_by) values
  (t.u('C'), t.id('S1'), t.id('M2')),
  (t.u('C'), t.id('S2'), t.id('M2'));
insert into course_chat_reads (course_id, user_id, last_read_at)
  select t.u('C'), t.u(k), now() - interval '5 hours' from unnest(array['M2', 'S1', 'S2', 'T', 'T2']) k;
insert into course_messages (id, course_id, author_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000044a1', t.u('C'), t.id('S1'), 'from S1', now() - interval '4 hours'),
  ('00000000-0000-0000-0000-0000000044b2', t.u('C'), t.id('S2'), 'from S2', now() - interval '4 hours');
select t.bot();
select t.eq((select array_to_string(array(select k from unnest(array['M2', 'S1', 'S2', 'T', 'T2']) k
    where t.u(k) = any (r.recipient_ids) order by k), ',')
  from chat_message_recipients('00000000-0000-0000-0000-0000000044a1') r), 'M2,S2,T,T2',
  'AC10 first post (S1): owner, S2 and both teachers');
select t.eq((select array_to_string(array(select k from unnest(array['M2', 'S1', 'S2', 'T', 'T2']) k
    where t.u(k) = any (r.recipient_ids) order by k), ',')
  from chat_message_recipients('00000000-0000-0000-0000-0000000044b2') r), 'S1',
  'AC10 second post (S2, same time, larger id): only S1 (it is S1''s oldest new message); the others left out');
reset role;

-- AC 8 / AC 7: the trigger. (i) No Vault secrets: every insert above succeeded and queued nothing.
select t.eq((select count(*) from net.requests), 0::bigint, 'AC7 (i) no Vault secrets: no call queued for any insert');
select t.login('S1');
select t.lives($$insert into course_messages (id, course_id, author_id, body)
  values ('$$ || t.u('n1') || $$', '$$ || t.id('A') || $$', '$$ || t.id('S1') || $$', 'hi')$$,
  'AC7 (i) an app user posts with no secrets');
reset role;
select t.eq((select count(*) from net.requests), 0::bigint, 'AC7 (i) still no call');

-- Only the URL set: skipped.
insert into vault.decrypted_secrets (name, decrypted_secret)
  values ('chat_notify_url', 'https://x.supabase.co/functions/v1/chat-message-notifications');
select t.post('n2', 'A', 'M', interval '0 seconds');
select t.eq((select count(*) from net.requests), 0::bigint, 'AC8 secret missing: no call');

-- (iii) Both set: one insert, exactly one call with the message id and the bearer secret.
insert into vault.decrypted_secrets (name, decrypted_secret) values ('chat_notify_secret', 's3cret');
select t.login('S1');
select t.lives($$insert into course_messages (id, course_id, author_id, body)
  values ('$$ || t.u('n3') || $$', '$$ || t.id('A') || $$', '$$ || t.id('S1') || $$', 'hello')$$,
  'AC8 (iii) an app user posts with secrets set');
reset role;
select t.eq((select count(*) from net.requests), 1::bigint, 'AC8 (iii) exactly one call for one insert');
select t.eq((select body from net.requests), jsonb_build_object('message_id', t.u('n3')), 'AC8 body is {"message_id": id}');
select t.eq((select headers ->> 'Authorization' from net.requests), 'Bearer s3cret', 'AC8 Authorization: Bearer <secret>');
select t.eq((select url from net.requests), 'https://x.supabase.co/functions/v1/chat-message-notifications', 'AC8 the Vault URL');
select t.ok((select timeout_milliseconds from net.requests) > 0, 'AC8 an explicit timeout');
select t.eq((select params from net.requests), '{}'::jsonb, 'AC8 named arguments: headers not sent as query params');

-- (ii) net.http_post raising: the insert still succeeds and the message is saved.
create or replace function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000
) returns bigint language plpgsql as $$ begin raise exception 'pg_net is down'; end $$;
select t.login('S1');
select t.lives($$insert into course_messages (id, course_id, author_id, body)
  values ('$$ || t.u('n4') || $$', '$$ || t.id('A') || $$', '$$ || t.id('S1') || $$', 'still works')$$,
  'AC7 (ii) net.http_post raising: the insert succeeds');
select t.ok(exists (select 1 from course_messages where id = t.u('n4')), 'AC7 (ii) and the message is shown');
reset role;
select t.eq((select count(*) from net.requests), 1::bigint, 'AC7 (ii) nothing more recorded');

-- pg_net and Vault not there at all: still saved.
drop schema net cascade;
drop schema vault cascade;
select t.login('S1');
select t.lives($$insert into course_messages (id, course_id, author_id, body)
  values ('$$ || t.u('n5') || $$', '$$ || t.id('A') || $$', '$$ || t.id('S1') || $$', 'no pg_net')$$,
  'AC7 pg_net and Vault missing: the insert succeeds');
select t.ok(exists (select 1 from course_messages where id = t.u('n5')), 'AC7 and the message is shown');
reset role;
