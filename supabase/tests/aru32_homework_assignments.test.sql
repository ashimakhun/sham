-- ARU-32: homework assignments on completed meetings. Rules under test: supabase/migrations/0013_homework_assignments.sql.
-- Course A owned by mentor M; course B owned by N. S1 a student listener of A, M2 a mentor listener of A, S2 in no
-- course. Meetings on A (inserted as the admin): C completed, C2 completed, F future scheduled, X canceled; D completed on B.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));
insert into course_meetings (id, course_id, starts_at, topic, status, created_by) values
  ('00000000-0000-0000-0000-00000000f321', t.id('A'), now() - interval '2 days', 'Done', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000000f322', t.id('A'), now() - interval '3 days', 'Done 2', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000000f323', t.id('A'), now() + interval '1 day', 'Future', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f324', t.id('A'), now() - interval '4 days', 'Dropped', 'canceled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f325', t.id('B'), now() - interval '2 days', 'B done', 'completed', t.id('N'));

-- Data
select t.ok(exists (select 1 from information_schema.columns where table_name = 'homework' and column_name = 'assignment_id'
  and is_nullable = 'YES'), 'data: homework.assignment_id nullable');
select t.eq((select count(*) from homework where assignment_id is not null), 0::bigint, 'data: existing homework has no assignment');
select t.eq((select count(*) from pg_policies where tablename = 'homework_assignments' and cmd in ('UPDATE', 'DELETE', 'ALL')), 0::bigint,
  'data: no update or delete policy on homework_assignments');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'homework_assignments'),
  'data: homework_assignments is in supabase_realtime');
select t.ok(not has_column_privilege('authenticated', 'homework', 'assignment_id', 'update'), 'data: checkers cannot change assignment_id');

-- AC 1: the owner assigns (title trimmed, no deadline); the teacher assigns with a future deadline on B.
select t.login('M');
select t.lives($$insert into homework_assignments (id, meeting_id, course_id, title, description, created_by) values
  ('00000000-0000-0000-0000-00000000a321', '00000000-0000-0000-0000-00000000f321', '00000000-0000-0000-0000-0000000000d1',
   '  Exercises 1-10  ', ' Do them all ', '00000000-0000-0000-0000-0000000000b1')$$, 'AC1 owner assigns on a completed meeting');
reset role;
select t.eq((select title || '|' || description || '|' || coalesce(due_at::text, 'none') from homework_assignments
  where id = '00000000-0000-0000-0000-00000000a321'), 'Exercises 1-10|Do them all|none', 'AC1 title and description trimmed; no deadline');
select t.login('T');
select t.lives($$insert into homework_assignments (id, meeting_id, course_id, title, due_at, created_by) values
  ('00000000-0000-0000-0000-00000000a325', '00000000-0000-0000-0000-00000000f325', '00000000-0000-0000-0000-0000000000d2',
   'Teacher hw', now() + interval '2 days', '00000000-0000-0000-0000-0000000000a1')$$, 'AC1 teacher assigns on any course with a deadline');

-- AC 1: deadline in the past, blank or long title.
select t.login('M');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, due_at, created_by) values
  ('00000000-0000-0000-0000-00000000f322', '00000000-0000-0000-0000-0000000000d1', 'Late', now() - interval '1 minute',
   '00000000-0000-0000-0000-0000000000b1')$$, '23514', 'AC1 deadline in the past rejected');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f322', '00000000-0000-0000-0000-0000000000d1', '   ', '00000000-0000-0000-0000-0000000000b1')$$,
  '23514', 'AC1 blank title rejected');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f322', '00000000-0000-0000-0000-0000000000d1', repeat('x', 201), '00000000-0000-0000-0000-0000000000b1')$$,
  '23514', 'AC1 201-character title rejected');
select t.lives($$insert into homework_assignments (id, meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000a322', '00000000-0000-0000-0000-00000000f322', '00000000-0000-0000-0000-0000000000d1',
   repeat('x', 200), '00000000-0000-0000-0000-0000000000b1')$$, 'AC1 200-character title accepted');

-- AC 2: a retry with the same id is a duplicate key (the app treats it as saved).
select t.throws($$insert into homework_assignments (id, meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000a321', '00000000-0000-0000-0000-00000000f321', '00000000-0000-0000-0000-0000000000d1',
   'Again', '00000000-0000-0000-0000-0000000000b1')$$, '23505', 'AC2 same id again → duplicate key');

-- AC 3: second assignment, scheduled, canceled.
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f321', '00000000-0000-0000-0000-0000000000d1', 'Second', '00000000-0000-0000-0000-0000000000b1')$$,
  '23505', 'AC3 second assignment for a meeting rejected');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f323', '00000000-0000-0000-0000-0000000000d1', 'Sched', '00000000-0000-0000-0000-0000000000b1')$$,
  '23514', 'AC3 scheduled meeting rejected');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f324', '00000000-0000-0000-0000-0000000000d1', 'Canc', '00000000-0000-0000-0000-0000000000b1')$$,
  '23514', 'AC3 canceled meeting rejected');
do $$ begin
  insert into homework_assignments (meeting_id, course_id, title, created_by) values
    ('00000000-0000-0000-0000-00000000f321', '00000000-0000-0000-0000-0000000000d1', 'Second', '00000000-0000-0000-0000-0000000000b1');
exception when others then perform t.eq(sqlerrm, 'This meeting already has homework.', 'AC3 duplicate message');
end $$;
do $$ begin
  insert into homework_assignments (meeting_id, course_id, title, created_by) values
    ('00000000-0000-0000-0000-00000000f324', '00000000-0000-0000-0000-0000000000d1', 'Canc', '00000000-0000-0000-0000-0000000000b1');
exception when others then perform t.eq(sqlerrm, 'Homework can be assigned only to completed meetings.', 'AC3 status message');
end $$;
-- The meeting must belong to the course given.
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f325', '00000000-0000-0000-0000-0000000000d1', 'Wrong course', '00000000-0000-0000-0000-0000000000b1')$$,
  'P0002', 'a meeting of another course is rejected');

-- AC 4: other mentors, listeners and students can't assign; nor as someone else.
reset role;
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  ('00000000-0000-0000-0000-00000000f326', t.id('A'), now() - interval '5 days', 'completed', t.id('M'));
select t.login('N');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f326', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000b2')$$,
  '42501', 'AC4 other mentor rejected');
select t.login('M2');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f326', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000b3')$$,
  '42501', 'AC4 mentor listener rejected');
select t.login('S1');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f326', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000c1')$$,
  '42501', 'AC4 student rejected');
select t.login('M');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f326', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', 'AC4 owner assigning as someone else rejected');
-- Former owner: A moves to N; M can no longer assign, N can.
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2')$$, 'A moves to N');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f326', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000b1')$$,
  '42501', 'AC4 former owner rejected');
select t.login('N');
select t.lives($$insert into homework_assignments (id, meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000a326', '00000000-0000-0000-0000-00000000f326', '00000000-0000-0000-0000-0000000000d1',
   'By the new owner', '00000000-0000-0000-0000-0000000000b2')$$, 'new owner assigns');

-- No update or delete, for anyone.
select t.login('T');
select t.eq(t.affected($$update homework_assignments set title = 'changed'$$), 0::bigint, 'teacher cannot update assignments');
select t.eq(t.affected($$delete from homework_assignments$$), 0::bigint, 'teacher cannot delete assignments');

-- Reading: mentors and the teacher see all; S1 sees A's only; S2 none.
select t.login('S1');
select t.eq((select count(*) from homework_assignments), 3::bigint, 'S1 sees A''s three assignments');
select t.login('S2');
select t.eq((select count(*) from homework_assignments), 0::bigint, 'S2 sees none');
select t.login('M2');
select t.eq((select count(*) from homework_assignments), 4::bigint, 'a mentor sees all');

-- AC 12 / AC 7 / AC 8: sending homework.
select t.login('S1');
select t.lives($$insert into homework (id, student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-00000000e321',
  '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 'Mine', '00000000-0000-0000-0000-00000000a321')$$,
  'AC7 S1 sends homework for A''s assignment');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d1', 'Again', '00000000-0000-0000-0000-00000000a321')$$, '23505',
  'AC8 a second homework for the same assignment rejected');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d1', 'No assignment')$$, '42501', 'AC12 homework without an assignment rejected');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d1', 'Wrong course', '00000000-0000-0000-0000-00000000a325')$$, '42501',
  'AC12 B''s assignment with course A rejected');
select t.login('M2');
select t.lives($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000b3',
  '00000000-0000-0000-0000-0000000000d1', 'Mentor listener', '00000000-0000-0000-0000-00000000a321')$$,
  'AC7 mentor listener sends for the same assignment');
select t.login('S2');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c2',
  '00000000-0000-0000-0000-0000000000d1', 'Not in A', '00000000-0000-0000-0000-00000000a321')$$, '42501', 'AC12 non-listener rejected');
select t.login('T');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000d1', 'Teacher', '00000000-0000-0000-0000-00000000a321')$$, '42501', 'AC12 teacher rejected');

-- AC 11: checking linked homework works as before; the checker can't move it to another assignment.
select t.login('M');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b1', checked_at = now()
  where id = '00000000-0000-0000-0000-00000000e321'$$), 1::bigint, 'AC11 a mentor checks linked homework');
select t.throws($$update homework set assignment_id = null where id = '00000000-0000-0000-0000-00000000e321'$$, '42501',
  'AC11 assignment_id is not updatable');

-- Removing a listener still deletes their homework, linked rows included.
select t.login('M');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b3')$$,
  'remove M2 from A');
reset role;
select t.eq((select count(*) from homework where student_id = t.id('M2')), 0::bigint, 'removed listener''s linked homework deleted');
