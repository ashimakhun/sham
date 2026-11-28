-- ARU-197: the course owner or the teacher marks a course Completed and can reopen it.
-- Rules under test: supabase/migrations/0082_complete_course.sql.
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2; students S1, S2, S3.
-- Here: A has listeners S1 (student) and M2 (mentor), five Completed meetings with homework (t.make_assignments), a
-- Completed meeting without homework (MC), two Scheduled meetings (MF in the future, MP already started) and one
-- meeting canceled long ago (MX). B has listener S2 and no meeting at all. H is a hidden course owned by N.
-- A second workspace has teacher XT.
select t.seed();
select t.make_assignments(t.id('A'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('M2'), t.id('M')), (t.id('B'), t.id('S2'), t.id('N'));
create function t.m(n text) returns uuid language sql immutable as $$ select md5('aru197-' || n)::uuid $$;
grant execute on function t.m(text) to anon, authenticated;
set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, status, created_by, status_changed_by, status_changed_at, workspace_id) values
  (t.m('MC'), t.id('A'), now() - interval '3 hours', 'completed', t.id('M'), t.id('M'), now() - interval '2 hours', (select workspace_id from courses where id = t.id('A'))),
  (t.m('MF'), t.id('A'), now() + interval '1 day', 'scheduled', t.id('M'), null, null, (select workspace_id from courses where id = t.id('A'))),
  (t.m('MP'), t.id('A'), now() - interval '10 minutes', 'scheduled', t.id('M'), null, null, (select workspace_id from courses where id = t.id('A'))),
  (t.m('MX'), t.id('A'), now() - interval '9 days', 'canceled', t.id('M'), t.id('T'), '2020-01-01T00:00:00Z', (select workspace_id from courses where id = t.id('A')));
set session_replication_role = origin;
insert into courses (id, title, created_by, hidden) values (t.m('H'), 'Hidden one', t.id('N'), true);

-- What a statement raises: errcode | hint (or 'no error').
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return concat_ws(' | ', code, nullif(hint, ''));
end $$;
grant execute on function pg_temp.err(text) to authenticated, anon;
create function pg_temp.complete(course uuid) returns text language sql as $$
  select pg_temp.err(format('select complete_course(%L)', course)) $$;
create function pg_temp.reopen(course uuid) returns text language sql as $$
  select pg_temp.err(format('select reopen_course(%L)', course)) $$;
grant execute on function pg_temp.complete(uuid), pg_temp.reopen(uuid) to authenticated, anon;
-- The course's state as the admin sees it (not through RLS).
create function pg_temp.done_at(course uuid) returns timestamptz language sql security definer as $$
  select completed_at from public.courses where id = course $$;
create function pg_temp.done_by(course uuid) returns uuid language sql security definer as $$
  select completed_by from public.courses where id = course $$;
create function pg_temp.status_of(meeting uuid) returns text language sql security definer as $$
  select status::text from public.course_meetings where id = meeting $$;
grant execute on function pg_temp.done_at(uuid), pg_temp.done_by(uuid), pg_temp.status_of(uuid) to authenticated, anon;
-- Statements used more than once.
create function pg_temp.new_meeting(course uuid, who text) returns text language sql as $$
  select format('insert into course_meetings (course_id, starts_at, created_by) values (%L, now() + interval ''2 days'', %L)',
    course, t.id(who)) $$;
create function pg_temp.new_assignment(meeting uuid, who text) returns text language sql as $$
  select format('insert into homework_assignments (meeting_id, course_id, title, created_by) values (%L, %L, ''Extra'', %L)',
    meeting, t.id('A'), t.id(who)) $$;
create function pg_temp.new_listener(course uuid, member text, who text) returns text language sql as $$
  select format('insert into course_members (course_id, user_id, added_by) values (%L, %L, %L)', course, t.id(member), t.id(who)) $$;
grant execute on function pg_temp.new_meeting(uuid, text), pg_temp.new_assignment(uuid, text),
  pg_temp.new_listener(uuid, text, text) to authenticated, anon;

-- Data checks.
select t.ok((select count(*) = 0 from courses where completed_at is not null or completed_by is not null),
  'data: existing courses stay active (both columns null)');
select t.ok((select bool_and(prosecdef and proconfig::text like '%search_path=public%') from pg_proc
  where proname in ('complete_course', 'reopen_course', 'course_completed', 'course_completed_guard')),
  'data: the functions are security definer with search_path');
select t.ok(not has_function_privilege('anon', 'complete_course(uuid)', 'execute')
  and not has_function_privilege('anon', 'reopen_course(uuid)', 'execute')
  and not has_function_privilege('anon', 'course_completed(uuid)', 'execute'), 'data: anon cannot run them');
select t.ok(not has_function_privilege('public', 'complete_course(uuid)', 'execute')
  and not has_function_privilege('public', 'reopen_course(uuid)', 'execute'), 'data: public cannot run them');
select t.ok(has_function_privilege('authenticated', 'complete_course(uuid)', 'execute')
  and has_function_privilege('authenticated', 'reopen_course(uuid)', 'execute'), 'data: authenticated can');
select t.ok(not exists (select 1 from pg_policies where tablename = 'courses' and cmd in ('UPDATE', 'ALL')),
  'data: courses still has no update policy');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'courses')
  and exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_meetings'),
  'AC3 data: courses and meetings are in realtime');
select t.eq((select count(*) from pg_policies where tablename in ('course_meetings', 'homework_assignments', 'course_members')
  and policyname like 'completed courses:%' and permissive = 'RESTRICTIVE' and cmd = 'INSERT'), 3::bigint,
  'data: a restrictive insert policy on each of the three tables');

-- Note 3: a course can't be created already completed.
select t.login('M');
select t.lives(format('insert into courses (id, title, created_by, completed_at, completed_by) values (%L, ''Born done'', %L, now(), %L)',
  t.m('NEW'), t.id('M'), t.id('M')), 'note 3: a mentor creates a course sending completed_at / completed_by');
select t.ok(pg_temp.done_at(t.m('NEW')) is null and pg_temp.done_by(t.m('NEW')) is null, 'note 3: it is active all the same');
select t.eq(t.affected(format('update courses set completed_at = now(), completed_by = %L where id = %L', t.id('M'), t.id('A'))),
  0::bigint, 'the owner can''t set completed_at with a direct update (no update policy)');
select t.ok(pg_temp.done_at(t.id('A')) is null, 'the course is still active');

-- AC 12: everyone but the owner and the teacher is refused, and nothing changes.
select t.login('N');
select t.eq(pg_temp.complete(t.id('A')), '42501 | sham:course_complete_role', 'AC12 another mentor can''t complete');
select t.login('M2');
select t.eq(pg_temp.complete(t.id('A')), '42501 | sham:course_complete_role', 'AC12 a mentor listener can''t complete');
select t.login('S1');
select t.eq(pg_temp.complete(t.id('A')), '42501 | sham:course_complete_role', 'AC12 a student listener can''t complete');
select t.login('S3');
select t.eq(pg_temp.complete(t.id('A')), '42501 | sham:course_complete_role', 'AC12 a student outside the course can''t complete');
select t.login(null);
select t.ok(pg_temp.complete(t.id('A')) like '42501%', 'AC12 signed out: refused');
select t.login('M');
select t.eq(pg_temp.complete(t.m('H')), 'P0002 | sham:course_not_found', 'AC12 a course hidden from the caller: not found');
select t.eq(pg_temp.complete(gen_random_uuid()), 'P0002 | sham:course_not_found', 'AC12 a missing course: not found');
select t.ok(pg_temp.done_at(t.id('A')) is null and pg_temp.done_at(t.m('H')) is null, 'AC12 nothing was completed');
select t.eq(pg_temp.status_of(t.m('MF')), 'scheduled', 'AC12 the meetings are untouched');
-- Reopening an active course changes nothing.
select t.eq(pg_temp.reopen(t.id('A')), 'no error', 'AC12 reopening an active course is a no-op');
select t.ok(pg_temp.done_at(t.id('A')) is null, 'AC12 it is still active');

-- AC 3: the owner completes. Who and when are saved; Scheduled meetings (the started one too) become Canceled.
select t.eq(pg_temp.complete(t.id('A')), 'no error', 'AC3 the owner completes the course');
select t.ok(pg_temp.done_at(t.id('A')) is not null, 'AC3 completed_at is set');
select t.eq(pg_temp.done_by(t.id('A')), t.id('M'), 'AC3 completed_by is the owner');
select t.eq(pg_temp.status_of(t.m('MF')), 'canceled', 'AC3 the future Scheduled meeting is canceled');
select t.eq(pg_temp.status_of(t.m('MP')), 'canceled', 'AC3 the Scheduled meeting in progress is canceled');
reset role;
select t.ok((select bool_and(status_changed_by = t.id('M') and status_changed_at is not null)
  from course_meetings where id in (t.m('MF'), t.m('MP'))), 'AC3 who and when canceled them are saved');
select t.eq((select status_changed_at from course_meetings where id = t.m('MX')), '2020-01-01T00:00:00Z'::timestamptz,
  'AC3 a meeting canceled earlier is unchanged');
select t.eq((select count(*) from course_meetings where course_id = t.id('A') and status = 'completed'), 6::bigint,
  'AC3 Completed meetings are unchanged');
select t.ok(pg_temp.done_at(t.id('B')) is null, 'AC3 another course is untouched');

-- AC 12: completing again is a no-op; the first time and person stay.
create temp table first_done as select completed_at from courses where id = t.id('A');
grant select on first_done to authenticated;
select t.login('T');
select t.eq(pg_temp.complete(t.id('A')), 'no error', 'AC12 completing a completed course: no error');
select t.ok(pg_temp.done_at(t.id('A')) = (select completed_at from first_done) and pg_temp.done_by(t.id('A')) = t.id('M'),
  'AC12 completed_at and completed_by stay');

-- AC 4: everyone who sees the course reads the state.
select t.login('S3');
select t.ok((select completed_at is not null from courses where id = t.id('A')), 'AC4 a student outside the course reads the state');
select t.ok(course_completed(t.id('A')) and not course_completed(t.id('B')), 'data: course_completed() tells A from B');

-- AC 5: no new meeting, for the owner and the teacher (trigger: the new code), by any path.
select t.login('M');
select t.eq(pg_temp.err(pg_temp.new_meeting(t.id('A'), 'M')), '23514 | sham:course_completed_no_meetings', 'AC5 the owner can''t schedule');
select t.login('T');
select t.eq(pg_temp.err(pg_temp.new_meeting(t.id('A'), 'T')), '23514 | sham:course_completed_no_meetings', 'AC5 the teacher can''t schedule');
reset role;
select t.eq(pg_temp.err(pg_temp.new_meeting(t.id('A'), 'M')), '23514 | sham:course_completed_no_meetings',
  'AC5 not even outside the app roles (definer functions, service role)');
select t.login('M');
select t.eq(pg_temp.err(pg_temp.new_meeting(t.m('NEW'), 'M')), 'no error', 'AC5 an active course still takes meetings');

-- AC 6: no new homework assignment (MC is Completed and has none).
select t.eq(pg_temp.err(pg_temp.new_assignment(t.m('MC'), 'M')), '23514 | sham:course_completed_no_homework', 'AC6 the owner can''t assign');
select t.login('T');
select t.eq(pg_temp.err(pg_temp.new_assignment(t.m('MC'), 'T')), '23514 | sham:course_completed_no_homework', 'AC6 the teacher can''t assign');
select t.login('S1');
select t.eq(pg_temp.err(pg_temp.new_assignment(t.m('MC'), 'S1')), '42501 | sham:assign_homework_role',
  'AC6 a listener still gets the role refusal first');

-- AC 7: no new listener; removing works as today.
select t.login('M');
select t.eq(pg_temp.err(pg_temp.new_listener(t.id('A'), 'S3', 'M')), '23514 | sham:course_completed_no_listeners', 'AC7 the owner can''t add a listener');
select t.login('T');
select t.eq(pg_temp.err(pg_temp.new_listener(t.id('A'), 'S3', 'T')), '23514 | sham:course_completed_no_listeners', 'AC7 the teacher can''t add a listener');
select t.login('N');
select t.eq(pg_temp.err(pg_temp.new_listener(t.id('A'), 'S3', 'N')), '23514 | sham:course_completed_no_listeners', 'AC7 another mentor can''t either');
select t.eq(pg_temp.err(pg_temp.new_listener(t.id('B'), 'S3', 'N')), 'no error', 'AC7 an active course still takes listeners');
select t.login('M');
select t.lives(format('select remove_listener(%L, %L)', t.id('A'), t.id('M2')), 'AC7 removing a listener still works');
reset role;
select t.ok(not exists (select 1 from course_members where course_id = t.id('A') and user_id = t.id('M2')), 'AC7 the listener is gone');

-- AC 8: homework assigned before completing is still sent and checked, and the meeting's homework marked checked.
select t.login('S1');
select t.lives(format('select submit_homework(%L, %L, %L, %L, %L, %L)', t.m('HW'), t.id('A'), t.assignment(t.id('A'), 1),
  'After completing', '', array[t.id('S1') || '/' || t.m('HW') || '/1.jpg']), 'AC8 a listener sends homework for an old assignment');
select t.login('M');
select t.eq(t.affected(format($$update homework set status = 'checked', checked_by = %L, mentor_comment = 'ok' where id = %L$$,
  t.id('M'), t.m('HW'))), 1::bigint, 'AC8 the owner checks it and comments');
select t.lives(format('select set_meeting_homework_checked(%L, true)', md5('meeting' || t.id('A')::text || '1')::uuid),
  'AC8 the owner marks the meeting''s homework checked');

-- AC 10: the rest works as today on a completed course.
select t.lives(format('select set_course_description(%L, %L)', t.id('A'), 'Still editable'), 'AC10 the description is still edited');
select t.lives(format('insert into course_messages (course_id, author_id, body) values (%L, %L, ''hello'')', t.id('A'), t.id('M')),
  'AC10 the course chat still takes messages');
select t.login('S1');
select t.lives(format('select mark_attendance(%L)', t.m('MC')), 'AC10 attendance on a held meeting is still marked');
select t.lives(format('select add_meeting_listener_notes(%L, %L, true)', t.m('MC'), 'my notes'), 'AC10 meeting notes are still written');

-- AC 9: feedback on a completed course, even if no meeting was ever completed (B has no meeting at all).
select t.login('S2');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 4, 'Early')$$, '42501',
  'AC9 an active course with no completed meeting still refuses feedback');
select t.login('N');
select t.eq(pg_temp.complete(t.id('B')), 'no error', 'edge: a course with no meetings can be completed');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 5, 'Mine')$$, '42501',
  'AC9 the owner (not a listener) still can''t add feedback');
select t.login('S2');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 4, 'Good')$$,
  'AC9 a listener adds feedback on a completed course with no completed meeting');
select t.eq(t.affected($$update course_feedback set rating = 5, body = 'Great' where user_id = auth.uid()$$), 1::bigint, 'AC9 and edits it');
select t.eq(t.affected($$delete from course_feedback where user_id = auth.uid()$$), 1::bigint, 'AC9 and deletes it');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 3, 'Again')$$, 'AC9 and adds it again');
select t.login('S1');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 4, 'Not in')$$, '42501',
  'AC9 a student who isn''t a listener can''t add feedback');
select t.eq((select count(*) from course_feedback where course_id = t.id('B')), 1::bigint, 'AC9 everyone who sees the course reads it');
select t.login('S1');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 5, 'A too')$$,
  'AC9 feedback on a completed course that has completed meetings');

-- AC 12 / access: reopen is for the same people.
select t.login('N');
select t.eq(pg_temp.reopen(t.id('A')), '42501 | sham:course_reopen_role', 'AC12 another mentor can''t reopen');
select t.login('S1');
select t.eq(pg_temp.reopen(t.id('A')), '42501 | sham:course_reopen_role', 'AC12 a listener can''t reopen');
select t.login(null);
select t.ok(pg_temp.reopen(t.id('A')) like '42501%', 'AC12 signed out: refused');
select t.ok(pg_temp.done_at(t.id('A')) is not null, 'AC12 the course is still completed');

-- Access: after an owner change the new owner can, the old one can't.
select t.login('T');
select t.lives(format('select change_course_owner(%L, %L)', t.id('A'), t.id('N')), 'AC10 the owner of a completed course is changed');
select t.login('M');
select t.eq(pg_temp.reopen(t.id('A')), '42501 | sham:course_reopen_role', 'access: the former owner can''t reopen');
select t.login('N');
select t.eq(pg_temp.reopen(t.id('A')), 'no error', 'AC11 the new owner reopens');

-- AC 11: active again. Inserts work; the meetings canceled by completing stay canceled; feedback stays.
select t.ok(pg_temp.done_at(t.id('A')) is null and pg_temp.done_by(t.id('A')) is null, 'AC11 both columns are cleared');
select t.eq(pg_temp.status_of(t.m('MF')), 'canceled', 'AC11 a meeting canceled by completing stays canceled');
select t.eq(pg_temp.status_of(t.m('MP')), 'canceled', 'AC11 the other one too');
select t.eq(pg_temp.err(pg_temp.new_meeting(t.id('A'), 'N')), 'no error', 'AC11 a new meeting is scheduled');
select t.eq(pg_temp.err(pg_temp.new_assignment(t.m('MC'), 'N')), 'no error', 'AC11 homework is assigned');
select t.eq(pg_temp.err(pg_temp.new_listener(t.id('A'), 'S3', 'N')), 'no error', 'AC11 a listener is added');
select t.eq((select count(*) from course_feedback where course_id = t.id('A')), 1::bigint, 'AC11 feedback stays');

-- The teacher: any course of the workspace, hidden ones too.
select t.login('T');
select t.eq(pg_temp.complete(t.m('H')), 'no error', 'access: the teacher completes a hidden course');
select t.eq(pg_temp.done_by(t.m('H')), t.id('T'), 'access: completed_by is the teacher');
select t.login('M');
select t.ok(not course_completed(t.m('H')), 'data: course_completed() tells nothing about a course hidden from the caller');
select t.ok(pg_temp.err(pg_temp.new_meeting(t.m('H'), 'M')) = '42501', 'a meeting for a hidden completed course: the usual RLS refusal, no new code');
select t.login('T');
select t.eq(pg_temp.reopen(t.m('H')), 'no error', 'access: the teacher reopens it');
select t.eq(pg_temp.complete(t.id('A')), 'no error', 'access: the teacher completes someone else''s course');
select t.eq(pg_temp.done_by(t.id('A')), t.id('T'), 'access: completed_by is the teacher');

-- A pending account is refused.
reset role;
update profiles set access_status = 'pending' where id = t.id('N');
select t.login('N');
select t.eq(pg_temp.reopen(t.id('A')), '42501 | sham:course_reopen_role', 'access: a pending owner is refused');
select t.eq(pg_temp.complete(t.id('B')), '42501 | sham:course_complete_role', 'access: completing too');
reset role;
update profiles set access_status = 'approved' where id = t.id('N');

-- Another workspace: its teacher can't reach this workspace's course.
insert into workspaces (id, name, created_at) values (t.m('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values (t.m('XT'), 'xt197@x.test', '{"full_name":"Xena Teacher"}');
update profiles set workspace_id = t.m('W2'), access_status = 'approved' where id = t.m('XT');
update profiles set role = 'teacher' where id = t.m('XT');
select set_config('request.jwt.claims', json_build_object('sub', t.m('XT'), 'role', 'authenticated')::text, false);
set role authenticated;
select t.eq(pg_temp.reopen(t.id('A')), 'P0002 | sham:course_not_found', 'AC12 another workspace''s teacher reopening: not found');
select t.eq(pg_temp.complete(t.id('B')), 'P0002 | sham:course_not_found', 'AC12 another workspace''s teacher completing: not found');
reset role;
select t.ok(pg_temp.done_at(t.id('A')) is not null, 'AC12 the course is unchanged');

