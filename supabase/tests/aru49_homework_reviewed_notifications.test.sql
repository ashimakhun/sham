-- ARU-49: homework_reviewed_recipient() and the submitted -> checked trigger that queues the pg_net call.
-- Rules under test: supabase/migrations/0037_homework_reviewed_notifications.sql.
-- Fixture (t.seed): course A owned by mentor M, B by mentor N; teacher T. S1 has HW_A1 (submitted, A), HW_A2 (checked,
-- A) and HW_B1 (submitted, B). Here: S1 and mentor M2 are listeners of A, S1 and S2 of B. Extra rows are made as the
-- admin with fixed ids md5('aru49-' || name).
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('B'), t.id('S1'), t.id('N')),
  (t.id('B'), t.id('S2'), t.id('N'));

create function t.hid(name text) returns uuid language sql immutable as $$ select md5('aru49-' || name)::uuid $$;
grant execute on function t.hid(text) to anon, authenticated, service_role;

create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- The recipient as "<course title>:<fixture name>", or '' when there is none. Called as the service role.
create function t.recipient(hw uuid) returns text language plpgsql as $$
declare
  result text;
begin
  perform t.bot();
  select coalesce(string_agg(r.course_title || ':' || coalesce(
           (select k from unnest(array['S1','S2','S3','M','M2','N','T']) k where t.id(k) = r.user_id), '?'), ' | '), '')
    into result from homework_reviewed_recipient(hw) r;
  reset role;
  return result;
end $$;
grant execute on function t.recipient(uuid) to service_role;

create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant execute on function t.calls() to anon, authenticated, service_role;

-- AC 8: grants.
select t.ok(not has_function_privilege('anon', 'homework_reviewed_recipient(uuid)', 'execute'), 'AC8 anon can''t run it');
select t.ok(not has_function_privilege('authenticated', 'homework_reviewed_recipient(uuid)', 'execute'),
  'AC8 app users can''t run it');
select t.ok(has_function_privilege('service_role', 'homework_reviewed_recipient(uuid)', 'execute'), 'AC8 the service role can');
select t.ok(not has_function_privilege('anon', 'notify_homework_reviewed()', 'execute')
  and not has_function_privilege('authenticated', 'notify_homework_reviewed()', 'execute'),
  'the trigger function isn''t executable by anon or app users');
select t.login('S1');
select t.throws(format('select * from homework_reviewed_recipient(%L)', t.id('HW_A2')), '42501',
  'AC8 the sender calling it is refused');
select t.login('T');
select t.throws(format('select * from homework_reviewed_recipient(%L)', t.id('HW_A2')), '42501',
  'AC8 the teacher calling it is refused');
select t.login(null);
select t.throws(format('select * from homework_reviewed_recipient(%L)', t.id('HW_A2')), '42501',
  'AC8 anon calling it is refused');
reset role;

-- AC 8 / rule: checked -> the sender with the current course title; still submitted -> nothing; unknown -> nothing.
select t.eq(t.recipient(t.id('HW_A2')), 'Algebra:S1', 'AC1 checked homework: the sender and the course title');
select t.eq(t.recipient(t.id('HW_A1')), '', 'rule (a) still submitted: nothing');
select t.eq(t.recipient(t.hid('nope')), '', 'AC8 unknown id: nothing');
update courses set title = 'Algebra 101 *_<' where id = t.id('A');
select t.eq(t.recipient(t.id('HW_A2')), 'Algebra 101 *_<:S1', 'edge: the title at processing time, as typed');
update courses set title = 'Algebra' where id = t.id('A');

-- AC 5: Pending or Rejected sender -> nothing.
update profiles set access_status = 'pending' where id = t.id('S1');
select t.eq(t.recipient(t.id('HW_A2')), '', 'AC5 Pending sender: nothing');
update profiles set access_status = 'rejected' where id = t.id('S1');
select t.eq(t.recipient(t.id('HW_A2')), '', 'AC5 Rejected sender: nothing');
update profiles set access_status = 'approved' where id = t.id('S1');
select t.eq(t.recipient(t.id('HW_A2')), 'Algebra:S1', 'Approved again: returned');

-- Mentor sender (a listener of A) -> returned.
insert into homework (id, student_id, course_id, title, status, checked_by)
  values (t.hid('M2'), t.id('M2'), t.id('A'), 'M2 hw', 'checked', t.id('M'));
select t.eq(t.recipient(t.hid('M2')), 'Algebra:M2', 'AC1 a mentor who sent homework as a listener gets it');

-- AC 5: listener removed via remove_listener() -> their homework is gone, nothing returned.
insert into homework (id, student_id, course_id, title, status, checked_by)
  values (t.hid('S2B'), t.id('S2'), t.id('B'), 'S2 hw', 'checked', t.id('N'));
select t.eq(t.recipient(t.hid('S2B')), 'Biology:S2', 'S2''s checked homework in B is returned');
select t.login('N');
select t.lives(format('select remove_listener(%L, %L)', t.id('B'), t.id('S2')), 'the owner removes S2 from B');
reset role;
select t.ok(not exists (select 1 from homework where id = t.hid('S2B')), 'AC5 remove_listener() deleted the homework');
select t.eq(t.recipient(t.hid('S2B')), '', 'AC5 removed listener: nothing');

-- Rule (c): a hidden course whose course_members row is deleted directly (homework kept) -> nothing.
insert into courses (id, title, created_by, hidden) values (t.hid('C'), 'Secret', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values (t.hid('C'), t.id('S3'), t.id('M'));
insert into homework (id, student_id, course_id, title, status, checked_by)
  values (t.hid('S3C'), t.id('S3'), t.hid('C'), 'S3 hw', 'checked', t.id('M'));
select t.eq(t.recipient(t.hid('S3C')), 'Secret:S3', 'hidden course, sender still a listener: returned');
delete from course_members where course_id = t.hid('C') and user_id = t.id('S3');
select t.eq(t.recipient(t.hid('S3C')), '', 'AC5 hidden course, membership deleted directly: nothing');
-- ... and the same in a non-hidden course -> returned.
delete from course_members where course_id = t.id('A') and user_id = t.id('S1');
select t.eq(t.recipient(t.id('HW_A2')), 'Algebra:S1', 'non-hidden course, membership deleted directly: returned');
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));

-- AC 7 (i) / AC 6: no Vault secrets -> the check succeeds and nothing is queued.
select t.login('M');
select t.lives(format('update homework set status = ''checked'', checked_by = %L, checked_at = now(), mentor_comment = %L where id = %L',
  t.id('M'), 'Nice', t.id('HW_A1')), 'AC6 a mentor checks with no Vault secrets');
reset role;
select t.eq((select status::text from homework where id = t.id('HW_A1')), 'checked', 'AC6 the homework is checked');
select t.eq(t.calls(), 0::bigint, 'AC7(i) no secrets: no call');

-- Only one of the two secrets -> still skipped.
update homework set status = 'submitted', checked_by = null, checked_at = null where id = t.id('HW_A1');
insert into vault.decrypted_secrets values
  ('homework_reviewed_notify_url', 'https://example.supabase.co/functions/v1/homework-reviewed-notifications');
select t.login('M');
select t.lives(format('update homework set status = ''checked'', checked_by = %L, checked_at = now() where id = %L',
  t.id('M'), t.id('HW_A1')), 'checked with only the URL in Vault');
reset role;
select t.eq(t.calls(), 0::bigint, 'AC7 a missing secret: no call');

-- AC 7 (iii): submitted -> checked queues exactly one call with the id, the header and a timeout.
update homework set status = 'submitted', checked_by = null, checked_at = null where id = t.id('HW_A1');
insert into vault.decrypted_secrets values ('homework_reviewed_notify_secret', 's3cret');
select t.login('M');
select t.lives(format('update homework set status = ''checked'', checked_by = %L, checked_at = now(), mentor_comment = %L where id = %L',
  t.id('M'), 'Well done', t.id('HW_A1')), 'a mentor checks with the secrets set');
reset role;
select t.eq(t.calls(), 1::bigint, 'AC7(iii) exactly one call');
select t.eq((select url from net.requests order by id desc limit 1),
  'https://example.supabase.co/functions/v1/homework-reviewed-notifications', 'AC7 posted to the Vault URL');
select t.eq((select body from net.requests order by id desc limit 1), jsonb_build_object('homework_id', t.id('HW_A1')),
  'AC7 body is {"homework_id": "<id>"} only');
select t.eq((select headers ->> 'Authorization' from net.requests order by id desc limit 1), 'Bearer s3cret',
  'AC7 Authorization: Bearer <secret>');
select t.eq((select timeout_milliseconds from net.requests order by id desc limit 1), 5000, 'AC7 explicit 5 s timeout');

-- AC 7 (iv) / AC 4: the row is already checked; status stays checked -> no call.
select t.login('M');
select t.lives(format('update homework set status = ''checked'', mentor_comment = %L where id = %L', 'Edited', t.id('HW_A1')),
  'a direct edit of a checked homework that sets status checked again');
select t.lives(format('update homework set mentor_comment = %L where id = %L', 'Edited again', t.id('HW_A1')),
  'a direct edit of the comment only on checked homework');
reset role;
select t.eq(t.calls(), 1::bigint, 'AC4/AC7(iv) updates that keep the status checked: no call');

-- AC 7 (v): an update that doesn't change status on submitted homework -> no call. (As the admin: the app's update
-- policy only lets a checker save checked homework.)
select t.lives(format('update homework set mentor_comment = %L where id = %L', 'Draft', t.id('HW_B1')),
  'comment-only update on submitted homework');
select t.lives(format('update homework set status = ''submitted'' where id = %L', t.id('HW_B1')),
  'status set to submitted again on submitted homework');
select t.eq(t.calls(), 1::bigint, 'AC7(v) no status change: no call');

-- AC 9: several homeworks of the same sender checked in a row -> one call each. The teacher checks too.
insert into homework (id, student_id, course_id, title, status) values
  (t.hid('S1x'), t.id('S1'), t.id('A'), 'x', 'submitted'),
  (t.hid('S1y'), t.id('S1'), t.id('A'), 'y', 'submitted');
select t.login('M');
select t.lives(format('update homework set status = ''checked'', checked_by = %L, checked_at = now() where id = %L',
  t.id('M'), t.hid('S1x')), 'check x');
select t.login('T');
select t.lives(format('update homework set status = ''checked'', checked_by = %L, checked_at = now() where id = %L',
  t.id('T'), t.hid('S1y')), 'the teacher checks y');
reset role;
select t.eq(t.calls(), 3::bigint, 'AC9 one call per checked homework');
select t.eq((select string_agg(body ->> 'homework_id', ',' order by id) from net.requests where id > 1),
  t.hid('S1x') || ',' || t.hid('S1y'), 'AC9 the calls carry each homework''s id');

-- Edge: set back to submitted and checked again (admin only) -> one more call.
update homework set status = 'submitted' where id = t.hid('S1x');
update homework set status = 'checked' where id = t.hid('S1x');
select t.eq(t.calls(), 4::bigint, 'edge: submitted -> checked again sends again');

-- AC 7 (ii) / AC 6: net.http_post raising -> the check still succeeds.
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language plpgsql as $$ begin raise exception 'pg_net is down'; end $$;
select t.login('N');
select t.lives(format('update homework set status = ''checked'', checked_by = %L, checked_at = now() where id = %L',
  t.id('N'), t.id('HW_B1')), 'AC6/AC7(ii) checking still succeeds when net.http_post raises');
reset role;
select t.eq((select status::text from homework where id = t.id('HW_B1')), 'checked', 'AC6 and the homework is checked');
select t.eq(t.calls(), 4::bigint, 'nothing recorded');

-- AC 6: pg_net not installed at all (no net.http_post) -> still succeeds.
drop function net.http_post(text, jsonb, jsonb, jsonb, integer);
update homework set status = 'submitted' where id = t.hid('S1y');
select t.login('T');
select t.lives(format('update homework set status = ''checked'', checked_by = %L, checked_at = now() where id = %L',
  t.id('T'), t.hid('S1y')), 'AC6 checking still succeeds without pg_net');
reset role;

-- No table, column or policy added for this story; existing homework untouched by the migration.
select t.ok(not exists (select 1 from pg_policies where policyname ilike '%review%'), 'no new RLS policy');
