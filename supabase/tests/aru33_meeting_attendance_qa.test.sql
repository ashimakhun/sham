-- ARU-33 QA additions to aru33_meeting_attendance.test.sql (TEST DESIGN "Access checks" and "Data checks"):
-- function privileges and definer settings, no write policies at all, the removed listener's mark kept after a real
-- remove_listener() with homework, a profile delete cascading to marks, a non-listener mentor/teacher undo, and the
-- ARU-32 / ARU-28 data on the same meeting staying untouched by marks.
select t.seed();
delete from homework;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));

set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, topic, status, created_by, notes) values
  ('00000000-0000-0000-0000-0000000a0001', t.id('A'), now() - interval '2 days', 'Done', 'completed', t.id('M'), 'Recap');
set session_replication_role = origin;

-- Definer settings and privileges.
select t.ok((select bool_and(p.prosecdef and 'search_path=public' = any(p.proconfig)) from pg_proc p
  where p.proname in ('mark_attendance', 'unmark_attendance')), 'data: both functions are security definer with search_path = public');
select t.ok(not has_function_privilege('anon', 'mark_attendance(uuid)', 'execute')
  and not has_function_privilege('anon', 'unmark_attendance(uuid)', 'execute'), 'roles: anon has no execute on either function');
select t.ok(has_function_privilege('authenticated', 'mark_attendance(uuid)', 'execute')
  and has_function_privilege('authenticated', 'unmark_attendance(uuid)', 'execute'), 'roles: authenticated can execute both');
select t.ok((select relrowsecurity from pg_class where oid = 'public.meeting_attendance'::regclass), 'data: RLS is on');
select t.eq((select string_agg(cmd, ',') from pg_policies where tablename = 'meeting_attendance'), 'SELECT',
  'data: the only policy is SELECT (writes only through the functions)');

-- Marks by S1 and S3; the assignment (ARU-32) and notes (ARU-28) of the same meeting are unaffected.
select t.login('M');
select t.lives($$insert into homework_assignments (id, meeting_id, course_id, title, created_by) values ('00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000000d1', 'Exercises', '00000000-0000-0000-0000-0000000000b1')$$,
  'ARU-32 regression: the owner assigns homework on the completed meeting');
reset role; select t.login('S1');
select t.lives($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, 'S1 marks');
select t.lives($$insert into homework (student_id, course_id, assignment_id, title) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000aa001', 'My answers')$$,
  'ARU-32 regression: S1 still sends homework for the assignment');
reset role; select t.login('S3');
select t.lives($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, 'S3 marks');
reset role;
select t.eq((select notes from course_meetings where id = '00000000-0000-0000-0000-0000000a0001'), 'Recap',
  'ARU-28 regression: marks leave the meeting notes unchanged');
select t.eq((select status::text from course_meetings where id = '00000000-0000-0000-0000-0000000a0001'), 'completed',
  'marks leave the meeting status unchanged');

-- Non-listeners can't undo someone else's mark (there is no user argument, and they aren't listeners).
select t.login('T');
select t.throws($$select unmark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'AC5 the teacher cannot undo');
reset role; select t.login('N');
select t.throws($$select unmark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'AC5 a non-listener mentor cannot undo');
select t.eq((select count(*) from meeting_attendance), 2::bigint, 'AC8 a non-listener mentor reads both marks');
reset role;
select t.eq((select count(*) from meeting_attendance), 2::bigint, 'both marks still stored after the denied undos');

-- AC 9 with real data: remove_listener() deletes S1's homework for the course but keeps the attendance mark.
select t.login('M');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, 'AC9 remove S1 (with homework)');
reset role;
select t.eq((select count(*) from homework where student_id = t.id('S1')), 0::bigint, 'ARU-7 regression: S1''s homework in A is deleted');
select t.ok(exists (select 1 from meeting_attendance where user_id = t.id('S1')), 'AC9 S1''s attendance mark stays stored');

-- A deleted profile takes its marks with it (on delete cascade).
delete from profiles where id = t.id('S3');
select t.ok(not exists (select 1 from meeting_attendance where user_id = t.id('S3')), 'data: deleting a profile deletes its marks');
