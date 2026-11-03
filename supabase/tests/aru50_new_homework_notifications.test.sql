-- ARU-50: new_homework_recipients() and the after-insert trigger on homework_assignments that queues the pg_net call.
-- Rules under test: supabase/migrations/0038_new_homework_notifications.sql. net.http_post and vault.decrypted_secrets
-- are the stand-ins from _supabase_stubs.sql (net.requests records each queued call).
-- Fixture (t.seed): course A owned by mentor M, B by mentor N; teacher T. Listeners of A: S1 (student), M2 (mentor),
-- S3 (pending) and R (rejected); of B: S2. Hidden course H owned by N with listener S2; course E (owned by N) has none.
select t.seed();

-- Fixed ids for this file.
create function t.x(name text) returns uuid language sql immutable as $$ select md5('aru50-' || name)::uuid $$;
grant execute on function t.x(text) to anon, authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data) values (t.x('R'), 'r@x.test', '{"full_name":"Rejected Rex"}');
update profiles set access_status = 'approved' where id = t.x('R');
insert into courses (id, title, created_by, hidden) values
  (t.x('H'), 'Hidden *_<x>', t.id('N'), true),
  (t.x('E'), 'Empty', t.id('N'), false);
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M')),
  (t.id('A'), t.x('R'), t.id('M')),
  (t.id('B'), t.id('S2'), t.id('N')),
  (t.x('H'), t.id('S2'), t.id('N'));
update profiles set access_status = 'pending' where id = t.id('S3');
update profiles set access_status = 'rejected' where id = t.x('R');

-- Completed meetings (as the admin): A1..A6 on A, B1 on B, H1 on H, E1 on E; F1 a scheduled one on A.
insert into course_meetings (id, course_id, starts_at, topic, status, created_by)
  select t.x(m), c, now() - interval '1 day', 'Topic ' || m, 'completed', o
  from (values ('A1', t.id('A'), t.id('M')), ('A2', t.id('A'), t.id('M')), ('A3', t.id('A'), t.id('M')),
               ('A4', t.id('A'), t.id('M')), ('A5', t.id('A'), t.id('M')), ('A6', t.id('A'), t.id('M')),
               ('B1', t.id('B'), t.id('N')), ('H1', t.x('H'), t.id('N')), ('E1', t.x('E'), t.id('N'))) v (m, c, o);
insert into course_meetings (id, course_id, starts_at, topic, status, created_by)
  values (t.x('F1'), t.id('A'), now() + interval '1 day', 'Future', 'scheduled', t.id('M'));

create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- Assign homework `hw` on meeting `meeting` of `course` as the signed-in user (the app's insert).
create function t.assign(hw text, meeting text, course uuid, who text) returns text language sql as $$
  select format($f$insert into homework_assignments (id, meeting_id, course_id, title, created_by)
    values (%L, %L, %L, 'Exercises', %L)$f$, t.x(hw), t.x(meeting), course, t.id(who))
$$;
-- new_homework_recipients() as "title:keys" with fixture keys, sorted.
create function t.recipients(hw text) returns text language sql as $$
  select coalesce(max(x.course_title), '') || ':' || coalesce(string_agg(x.k, ',' order by x.k), '')
  from (
    select r.course_title,
      coalesce((select k from unnest(array['S1','S2','S3','M','M2','N','T']) k where t.id(k) = r.user_id),
               case when r.user_id = t.x('R') then 'R' else '?' end) as k
    from new_homework_recipients(t.x(hw)) r
  ) x
$$;
create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- Data and access (AC 9).
select t.ok(not has_function_privilege('anon', 'new_homework_recipients(uuid)', 'execute'), 'AC9 anon can''t run new_homework_recipients');
select t.ok(not has_function_privilege('authenticated', 'new_homework_recipients(uuid)', 'execute'), 'AC9 app users can''t run it');
select t.ok(has_function_privilege('service_role', 'new_homework_recipients(uuid)', 'execute'), 'AC9 the service role can');
select t.ok(not has_function_privilege('anon', 'homework_assignments_notify_new()', 'execute'), 'AC8 anon can''t run the trigger function');
select t.ok(not has_function_privilege('authenticated', 'homework_assignments_notify_new()', 'execute'), 'AC8 app users can''t run the trigger function');
select t.ok((select prosecdef and proconfig @> array['search_path=public'] from pg_proc where proname = 'new_homework_recipients'),
  'AC9 recipients: security definer, search_path = public');
select t.ok((select prosecdef and proconfig @> array['search_path=public'] from pg_proc where proname = 'homework_assignments_notify_new'),
  'AC8 trigger function: security definer, search_path = public');
select t.ok(exists (select 1 from pg_trigger where tgname = 'homework_assignments_notify_new'
  and tgrelid = 'homework_assignments'::regclass and (tgtype & 1) = 1 and (tgtype & 2) = 0 and (tgtype & 4) = 4
  and (tgtype & 24) = 0), 'AC8 after insert, for each row (not update or delete)');
select t.eq((select count(*) from pg_policies where tablename = 'homework_assignments' and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0::bigint, 'data: still no update or delete policy on homework_assignments');
select t.login('M');
select t.throws($$select * from new_homework_recipients('00000000-0000-0000-0000-000000000000')$$, '42501',
  'AC9 a mentor calling it is refused');
select t.login(null);
select t.throws($$select * from new_homework_recipients('00000000-0000-0000-0000-000000000000')$$, '42501',
  'AC9 anon calling it is refused');
reset role;

-- AC 7 / AC 11 (i): no Vault secrets → the insert succeeds and no call is queued.
select t.login('M');
select t.lives(t.assign('HW1', 'A1', t.id('A'), 'M'), 'AC7 owner assigns with no Vault secrets');
reset role;
select t.ok(exists (select 1 from homework_assignments where id = t.x('HW1')), 'AC7 the assignment is saved');
select t.eq(t.calls(), 0::bigint, 'AC8 no secrets → no call');

-- Only one of the two secrets → still no call.
insert into vault.decrypted_secrets values ('new_homework_notify_url', 'https://fn.test/functions/v1/new-homework-notifications');
select t.login('M');
select t.lives(t.assign('HW2', 'A2', t.id('A'), 'M'), 'AC8 assigns with only the URL in Vault');
reset role;
select t.eq(t.calls(), 0::bigint, 'AC8 secret missing → no call');
delete from vault.decrypted_secrets;
insert into vault.decrypted_secrets values ('new_homework_notify_secret', 's3cret');
select t.login('M');
select t.lives(t.assign('HW3', 'A3', t.id('A'), 'M'), 'AC8 assigns with only the secret in Vault');
reset role;
select t.eq(t.calls(), 0::bigint, 'AC8 URL missing → no call');

-- AC 11 (iii): both secrets → exactly one call with the id, the bearer and a timeout.
insert into vault.decrypted_secrets values ('new_homework_notify_url', 'https://fn.test/functions/v1/new-homework-notifications');
select t.login('M');
select t.lives(t.assign('HW4', 'A4', t.id('A'), 'M'), 'AC1 owner assigns with Vault set up');
reset role;
select t.eq(t.calls(), 1::bigint, 'AC8 one call queued for one insert');
select t.eq((select url from net.requests), 'https://fn.test/functions/v1/new-homework-notifications', 'AC8 call goes to the Vault URL');
select t.eq((select body from net.requests), jsonb_build_object('assignment_id', t.x('HW4')), 'AC8 body is {"assignment_id": <id>}');
select t.eq((select headers ->> 'Authorization' from net.requests), 'Bearer s3cret', 'AC8 Authorization: Bearer <secret>');
select t.eq((select timeout_milliseconds from net.requests), 5000, 'AC8 explicit 5000 ms timeout');

-- AC 4 / AC 11 (iv): a retry with the same id and rejected inserts queue nothing.
select t.login('M');
select t.throws(t.assign('HW4', 'A4', t.id('A'), 'M'), '23505', 'AC4 retry with the same id → 23505');
select t.throws(t.assign('HW4b', 'A4', t.id('A'), 'M'), '23505', 'AC4 second assignment for the meeting rejected');
select t.throws(t.assign('HW5f', 'F1', t.id('A'), 'M'), '23514', 'AC4 meeting not completed rejected');
select t.throws(format($f$insert into homework_assignments (id, meeting_id, course_id, title, due_at, created_by)
  values (%L, %L, %L, 'Late', now() - interval '1 minute', %L)$f$, t.x('HW5p'), t.x('A5'), t.id('A'), t.id('M')),
  '23514', 'AC4 past deadline rejected');
select t.login('N');
select t.throws(t.assign('HW5n', 'A5', t.id('A'), 'N'), '42501', 'AC4 not the owner rejected');
select t.login('S1');
select t.throws(t.assign('HW5s', 'A5', t.id('A'), 'S1'), '42501', 'AC4 a student listener can''t assign');
reset role;
select t.eq(t.calls(), 1::bigint, 'AC4 rejected and retried inserts queue no call');

-- AC 10: two in a row (different courses: teacher on B, then the owner on A) → one call each.
select t.login('T');
select t.lives(t.assign('HWB', 'B1', t.id('B'), 'T'), 'AC10 teacher assigns on B');
select t.login('M');
select t.lives(t.assign('HW5', 'A5', t.id('A'), 'M'), 'AC10 owner assigns again on A');
reset role;
select t.eq(t.calls(), 3::bigint, 'AC10 one call per assignment');
select t.eq((select array_agg(body ->> 'assignment_id' order by id) from net.requests),
  array[t.x('HW4')::text, t.x('HWB')::text, t.x('HW5')::text], 'AC10 each call carries its own assignment id');

-- AC 7 / AC 11 (ii): the call raising, pg_net missing, Vault missing → the insert still succeeds.
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$
begin
  raise exception 'pg_net is down';
end $$;
select t.login('M');
select t.lives(t.assign('HW6', 'A6', t.id('A'), 'M'), 'AC7 net.http_post raising → insert still succeeds');
reset role;
select t.ok(exists (select 1 from homework_assignments where id = t.x('HW6')), 'AC7 the assignment is saved despite the error');
drop function net.http_post(text, jsonb, jsonb, jsonb, integer);
select t.login('N');
select t.lives(t.assign('HWE', 'E1', t.x('E'), 'N'), 'AC7 pg_net not installed → insert still succeeds');
reset role;
alter table vault.decrypted_secrets rename to decrypted_secrets_off;
select t.login('N');
select t.lives(t.assign('HWH', 'H1', t.x('H'), 'N'), 'AC7 Vault missing → insert still succeeds (hidden course too)');
reset role;
alter table vault.decrypted_secrets_off rename to decrypted_secrets;
select t.eq(t.calls(), 3::bigint, 'AC7 nothing queued when the call fails');

-- AC 2 / AC 9: recipients of HW4 (course A): the student and mentor listeners only; not the owner M, the teacher, N,
-- M2-as-assigner, pending S3 or rejected R.
select t.bot();
select t.eq(t.recipients('HW4'), 'Algebra:M2,S1', 'AC2 student and mentor listeners; not owner, teacher, pending, rejected');
select t.eq(t.recipients('HWB'), 'Biology:S2', 'AC2 teacher-assigned on B → B''s listener only');
select t.eq(t.recipients('HWH'), 'Hidden *_<x>:S2', 'AC6 hidden course listeners are returned, title as typed');
select t.eq(t.recipients('HWE'), ':', 'AC9 course with no listeners → nothing');
select t.eq((select count(*) from new_homework_recipients('00000000-0000-0000-0000-000000000000')), 0::bigint,
  'AC9 unknown id → nothing');
select t.eq((select count(*) from new_homework_recipients(null)), 0::bigint, 'AC9 null id → nothing');
reset role;

-- The assigner is never a recipient, even a listener (can't happen through the app today; written as the admin
-- without triggers to set it up).
do $$ begin
  perform set_config('session_replication_role', 'replica', true);
  insert into course_meetings (id, course_id, starts_at, status, created_by)
    values (t.x('A7'), t.id('A'), now() - interval '1 day', 'completed', t.id('M'));
  insert into homework_assignments (id, meeting_id, course_id, title, created_by)
    values (t.x('HWX'), t.x('A7'), t.id('A'), 'X', t.id('M2'));
  perform set_config('session_replication_role', 'origin', true);
end $$;
select t.bot();
select t.eq(t.recipients('HWX'), 'Algebra:S1', 'AC2 the assigner (a listener here) is left out');
reset role;

-- AC 5: listeners at processing time. Removing S1 (owner, through remove_listener) drops them; adding S2 to A before
-- the call includes them.
select t.login('M');
select remove_listener(t.id('A'), t.id('S1'));
select t.lives(format($f$insert into course_members (course_id, user_id, added_by) values (%L, %L, %L)$f$,
  t.id('A'), t.id('S2'), t.id('M')), 'AC5 owner adds S2 to A after the assignment');
reset role;
select t.bot();
select t.eq(t.recipients('HW4'), 'Algebra:M2,S2', 'AC5 removed listener left out, newly added one included');
reset role;

-- AC 3: the trigger never looks at telegram_links; the switch only matters in the Edge Function (Jest). Approving S3
-- later makes them a recipient of a call made now, never of one already sent (pg_net doesn't resend).
update profiles set access_status = 'approved' where id = t.id('S3');
select t.bot();
select t.eq(t.recipients('HW4'), 'Algebra:M2,S2,S3', 'AC2 an account approved later counts only from then on');
reset role;
