-- ARU-89: homework_submitted_recipient(), the Homework submitted switch and the after-insert trigger on homework that
-- queues the pg_net call. Rules under test: supabase/migrations/0045_homework_submitted_notifications.sql.
-- Fixture (t.seed): course A owned by mentor M, B by mentor N; teacher T. Here: S1, S2 and mentor M2 are listeners of A,
-- S1 of B; A and B get five assignments each ("Assignment n"). Extra ids: md5('aru89-' || name).
select t.seed();
select t.make_assignments(t.id('A'));
select t.make_assignments(t.id('B'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('B'), t.id('S1'), t.id('N'));

create function t.hid(name text) returns uuid language sql immutable as $$ select md5('aru89-' || name)::uuid $$;
grant execute on function t.hid(text) to anon, authenticated, service_role;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- Submit as a listener (through RLS): t.submit(who, name, course, n).
create function t.submit(who text, name text, course text, n int) returns text language sql as $$
  select format('insert into homework (id, student_id, course_id, title, assignment_id) values (%L, %L, %L, %L, %L)',
    t.hid(name), t.id(who), t.id(course), name, t.assignment(t.id(course), n))
$$;

-- "<sender>|<course>|<assignment>|<owner>" or '' when there is none. Called as the service role.
create function t.recipient(hw uuid) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select coalesce(string_agg(r.sender_name || '|' || r.course_title || '|' || r.assignment_title || '|' || coalesce(
           (select k from unnest(array['S1','S2','S3','M','M2','N','T']) k where t.id(k) = r.user_id), '?'), ' ; '), '')
    into result from homework_submitted_recipient(hw) r;
  reset role;
  return result;
end $$;
grant execute on function t.recipient(uuid) to service_role;

create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant execute on function t.calls() to anon, authenticated, service_role;

-- AC 4: the column and the switch.
insert into telegram_links (user_id, chat_id) values (t.id('M'), 2001), (t.id('S1'), 2002);
select t.ok((select notify_homework_submitted from telegram_links where user_id = t.id('M')), 'AC4 on by default');
select t.login('M');
select t.lives('select set_telegram_notification(''homework_submitted'', false)', 'AC4 the owner turns it off');
reset role;
select t.ok(not (select notify_homework_submitted from telegram_links where user_id = t.id('M')), 'AC4 saved off');
select t.ok((select notify_homework_submitted from telegram_links where user_id = t.id('S1')), 'AC4 only the caller''s row');
select t.ok((select notify_chat_message and notify_new_account from telegram_links where user_id = t.id('M')),
  'other switches untouched');
select t.login('M');
select t.lives('select set_telegram_notification(''homework_submitted'', true)', 'AC4 back on');
select t.lives('select set_telegram_notification(''new_account'', true)', 'ARU-84 kind still works');
select t.throws('select set_telegram_notification(''nope'', true)', '22023', 'unknown kind is still an error');
reset role;

-- AC 8: grants.
select t.ok(not has_function_privilege('anon', 'homework_submitted_recipient(uuid)', 'execute'), 'AC8 anon can''t run it');
select t.ok(not has_function_privilege('authenticated', 'homework_submitted_recipient(uuid)', 'execute'),
  'AC8 app users can''t run it');
select t.ok(has_function_privilege('service_role', 'homework_submitted_recipient(uuid)', 'execute'), 'AC8 the service role can');
select t.ok(not has_function_privilege('anon', 'notify_homework_submitted()', 'execute')
  and not has_function_privilege('authenticated', 'notify_homework_submitted()', 'execute'),
  'the trigger function isn''t executable by anon or app users');
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc
  where oid = 'notify_homework_submitted()'::regprocedure), 'trigger function: security definer, search_path=public');
select t.login('M');
select t.throws(format('select * from homework_submitted_recipient(%L)', t.id('HW_A1')), '42501', 'AC8 the owner calling it is refused');
select t.login(null);
select t.throws(format('select * from homework_submitted_recipient(%L)', t.id('HW_A1')), '42501', 'AC8 anon is refused');
reset role;

-- AC 7 / AC 9: no Vault secrets -> the submit succeeds, nothing queued.
select t.login('S1');
select t.lives(t.submit('S1', 'a1', 'A', 1), 'AC7 S1 submits with no Vault secrets');
reset role;
select t.ok(exists (select 1 from homework where id = t.hid('a1')), 'AC7 the homework is saved');
select t.eq(t.calls(), 0::bigint, 'AC9 no secrets: no call');

-- AC 1 / AC 2 / AC 9: the recipient is the owner, with the sender's name and the titles.
select t.eq(t.recipient(t.hid('a1')), 'Student Sam|Algebra|Assignment 1|M', 'AC1/AC2 the owner, with names and titles');
select t.eq(t.recipient(t.hid('nope')), '', 'AC9 unknown id: nothing');

-- Only the URL -> still skipped.
insert into vault.decrypted_secrets values
  ('homework_submitted_notify_url', 'https://example.supabase.co/functions/v1/homework-submitted-notifications');
select t.login('S2');
select t.lives(t.submit('S2', 'a2', 'A', 1), 'S2 submits with only the URL');
reset role;
select t.eq(t.calls(), 0::bigint, 'a missing secret: no call');

-- AC 8 / AC 9: one call with the id, the header and a timeout.
insert into vault.decrypted_secrets values ('homework_submitted_notify_secret', 's3cret');
select t.login('M2');
select t.lives(t.submit('M2', 'a3', 'A', 1), 'a mentor listener submits');
reset role;
select t.eq(t.calls(), 1::bigint, 'AC9 exactly one call');
select t.eq((select url from net.requests order by id desc limit 1),
  'https://example.supabase.co/functions/v1/homework-submitted-notifications', 'posted to the Vault URL');
select t.eq((select body from net.requests order by id desc limit 1), jsonb_build_object('homework_id', t.hid('a3')),
  'body is {"homework_id": "<id>"} only');
select t.eq((select headers ->> 'Authorization' from net.requests order by id desc limit 1), 'Bearer s3cret',
  'Authorization: Bearer <secret>');
select t.eq((select timeout_milliseconds from net.requests order by id desc limit 1), 5000, 'explicit 5 s timeout');
select t.eq(t.recipient(t.hid('a3')), 'Mentor Mo|Algebra|Assignment 1|M', 'AC1 a mentor sender: the owner gets it');

-- AC 3: a retried submit with the same id inserts nothing and queues nothing; a second homework for the assignment is
-- refused too.
select t.login('M2');
select t.throws(t.submit('M2', 'a3', 'A', 1), '23505', 'AC3 the same form id again is refused');
reset role;
select t.eq(t.calls(), 1::bigint, 'AC3 no new call for a retry');

-- AC 3: three submissions -> three calls.
select t.login('S1');
select t.lives(t.submit('S1', 'b1', 'A', 2), 'S1 submits #2');
select t.login('S2');
select t.lives(t.submit('S2', 'b2', 'A', 2), 'S2 submits #2');
select t.login('M2');
select t.lives(t.submit('M2', 'b3', 'A', 2), 'M2 submits #2');
reset role;
select t.eq((select string_agg(body ->> 'homework_id', ',' order by id) from net.requests where id > 1),
  t.hid('b1') || ',' || t.hid('b2') || ',' || t.hid('b3'), 'AC3 one call per submission');

-- AC 6: checking, unchecking and editing the comment -> no call.
select t.login('M');
select t.lives(format('update homework set status = ''checked'', checked_by = %L, checked_at = now(), mentor_comment = %L where id = %L',
  t.id('M'), 'Nice', t.hid('b1')), 'the owner checks');
reset role;
update homework set status = 'submitted', checked_by = null, checked_at = null where id = t.hid('b1');
update homework set mentor_comment = 'edited' where id = t.hid('b2');
select t.eq(t.calls(), 4::bigint, 'AC6 status and comment updates: no call');

-- AC 5: owner changed -> the new owner; not Approved / made a student -> nothing; homework or course deleted -> nothing.
select t.login('M');
select t.lives(format('select change_course_owner(%L, %L)', t.id('A'), t.id('T')), 'A moves to the teacher');
reset role;
select t.eq(t.recipient(t.hid('a1')), 'Student Sam|Algebra|Assignment 1|T', 'AC5 the new owner (the teacher) gets it');
update courses set created_by = t.id('M') where id = t.id('A');
update profiles set access_status = 'pending' where id = t.id('M');
select t.eq(t.recipient(t.hid('a1')), '', 'AC5 owner not Approved: nothing');
update profiles set access_status = 'approved' where id = t.id('M');
-- (The app refuses to make a course owner a student; bypass the guard triggers to simulate it.)
set session_replication_role = replica;
update profiles set role = 'student' where id = t.id('M');
set session_replication_role = origin;
select t.eq(t.recipient(t.hid('a1')), '', 'AC5 owner made a student (direct update): nothing');
set session_replication_role = replica;
update profiles set role = 'mentor' where id = t.id('M');
set session_replication_role = origin;
select t.eq(t.recipient(t.hid('a1')), 'Student Sam|Algebra|Assignment 1|M', 'back to M');
delete from homework where id = t.hid('a1');
select t.eq(t.recipient(t.hid('a1')), '', 'AC5 homework deleted: nothing');
select t.login('S1');
select t.lives(t.submit('S1', 'c1', 'B', 1), 'S1 submits in B');
reset role;
select t.eq(t.recipient(t.hid('c1')), 'Student Sam|Biology|Assignment 1|N', 'B''s owner N');
-- A course deleted while its homework is still waiting to be processed (FK checks bypassed to simulate it).
set session_replication_role = replica;
delete from courses where id = t.id('B');
set session_replication_role = origin;
select t.eq(t.recipient(t.hid('c1')), '', 'AC5 course deleted (homework left without its course): nothing');

-- Edge: hidden course works the same; current titles and names as typed.
update courses set hidden = true, title = 'Секрет *_<b>' where id = t.id('A');
update profiles set full_name = 'Sue 😀' where id = t.id('S2');
select t.eq(t.recipient(t.hid('b2')), 'Sue 😀|Секрет *_<b>|Assignment 2|M', 'hidden course, current values as typed');

-- AC 7: net.http_post raising -> the submit still succeeds.
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language plpgsql as $$ begin raise exception 'pg_net is down'; end $$;
select t.login('S1');
select t.lives(t.submit('S1', 'd1', 'A', 3), 'AC7 submit succeeds when net.http_post raises');
reset role;
select t.ok(exists (select 1 from homework where id = t.hid('d1')), 'AC7 and the homework is saved');

-- AC 7: pg_net not installed -> still succeeds.
drop function net.http_post(text, jsonb, jsonb, jsonb, integer);
select t.login('S2');
select t.lives(t.submit('S2', 'd2', 'A', 3), 'AC7 submit succeeds without pg_net');
reset role;

select t.ok(not exists (select 1 from pg_policies where policyname ilike '%submitted%'), 'no new RLS policy');
