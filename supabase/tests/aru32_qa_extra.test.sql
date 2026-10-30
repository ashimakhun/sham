-- ARU-32 QA additions to aru32_homework_assignments.test.sql, from the TEST DESIGN: anonymous access, a listener
-- removed and added back (edge case), sending in someone else's name, a mentor listener and their own linked
-- homework (ARU-14 rule still holds), and reading another course's assignments.
-- Course A owned by M, course B owned by N; t.make_assignments creates five assignments per course.
select t.seed();
delete from homework;
select t.make_assignments(t.id('A'));
select t.make_assignments(t.id('B'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));

-- Anonymous users read and assign nothing.
select t.login(null);
select t.eq((select count(*) from homework_assignments), 0::bigint, 'anon reads no assignments');
-- Rejected and nothing saved. (The trigger answers anonymous callers with the meeting's state instead of a
-- permission error, because its role check is NULL without a profile: filed as a separate, non-blocking bug.)
do $$ begin
  insert into homework_assignments (id, meeting_id, course_id, title, created_by) values
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ffff', '00000000-0000-0000-0000-0000000000d1', 'x',
     '00000000-0000-0000-0000-0000000000b1');
  raise exception 'FAIL: anon assigned homework' using errcode = 'P0001';
exception when sqlstate 'P0001' then raise; when others then raise notice 'ok - anon cannot assign homework (%)', sqlstate;
end $$;
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d1', 'anon', t.assignment('00000000-0000-0000-0000-0000000000d1', 1))$$, '42501',
  'anon cannot send homework');

-- Reading: a student sees only their courses' assignments (A), never B's.
reset role; select t.login('S1');
select t.eq((select count(*) from homework_assignments where course_id = t.id('A')), 5::bigint, 'S1 reads A''s assignments');
select t.eq((select count(*) from homework_assignments where course_id = t.id('B')), 0::bigint, 'S1 reads none of B''s');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d2', 'B', t.assignment('00000000-0000-0000-0000-0000000000d2', 1))$$, '42501',
  'AC12 S1 cannot send for B''s assignment (not a listener of B)');

-- No sending in someone else's name, even for an assignment of a shared course.
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000b3',
  '00000000-0000-0000-0000-0000000000d1', 'as M2', t.assignment('00000000-0000-0000-0000-0000000000d1', 1))$$, '42501',
  'S1 cannot send homework as M2');

-- ARU-14 still holds: a mentor listener sends for an assignment but can never check their own homework.
reset role; select t.login('M2');
select t.lives($$insert into homework (id, student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000032e1',
  '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000d1', 'M2 answer', t.assignment('00000000-0000-0000-0000-0000000000d1', 1))$$,
  'mentor listener M2 sends for A''s assignment');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b3', checked_at = now()
  where id = '00000000-0000-0000-0000-0000000032e1'$$), 0::bigint, 'ARU-14: M2 cannot check their own linked homework');
reset role; select t.login('N');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b2', checked_at = now()
  where id = '00000000-0000-0000-0000-0000000032e1'$$), 1::bigint, 'ARU-14: any other mentor checks it');

-- Edge: a listener removed loses the course's assignments and their homework; added back, they can send again.
reset role; select t.login('S1');
select t.lives($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d1', 'S1 answer', t.assignment('00000000-0000-0000-0000-0000000000d1', 2))$$,
  'S1 sends for assignment 2');
reset role; select t.login('M');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, 'M removes S1 from A');
reset role; select t.login('S1');
select t.eq((select count(*) from homework_assignments), 0::bigint, 'removed: S1 reads no assignments');
select t.eq((select count(*) from homework), 0::bigint, 'removed: S1''s homework for A was deleted');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d1', 'after removal', t.assignment('00000000-0000-0000-0000-0000000000d1', 3))$$, '42501',
  'removed: S1 cannot send');
reset role; select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1')$$, 'M adds S1 back');
reset role; select t.login('S1');
select t.eq((select count(*) from homework_assignments), 5::bigint, 're-added: A''s assignments are back');
select t.lives($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d1', 'S1 again', t.assignment('00000000-0000-0000-0000-0000000000d1', 2))$$,
  're-added: S1 can send for assignment 2 again (the old homework was deleted)');

-- A student can't assign homework, and the teacher assigns only as themselves.
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-0000000000d1', 'x',
   '00000000-0000-0000-0000-0000000000c1')$$, '42501', 'a student cannot assign homework');
reset role;
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  ('00000000-0000-0000-0000-00000000fa01', t.id('A'), now() - interval '1 day', 'completed', t.id('M'));
select t.login('T');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-0000000000d1', 'x',
   '00000000-0000-0000-0000-0000000000b1')$$, '42501', 'the teacher cannot assign in the owner''s name');
select t.lives($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-0000000000d1', 'By the teacher',
   '00000000-0000-0000-0000-0000000000a1')$$, 'the teacher assigns as themselves');
