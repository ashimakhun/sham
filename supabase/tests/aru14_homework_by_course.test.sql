-- ARU-14: listeners submit homework only to their courses; mentors and the teacher see and check all homework,
-- never their own (product-owner decision 2026-10-28). Rules under test: supabase/migrations/0005_homework_by_course.sql.
-- Users per the TEST DESIGN: teacher T; mentors M (owns A), N (owns B, listener of A), M2 (no course, S2's mentor_id);
-- students S1 (listener of A and B), S2 (no course).
select t.seed();
-- The seed's homework was created before memberships; AC 13 says the table starts empty, so start from scratch.
delete from homework;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('B'), t.id('S1'), t.id('N')),
  (t.id('A'), t.id('N'), t.id('M'));
update profiles set mentor_id = t.id('M2') where id = t.id('S2');

-- AC 13: data.
select t.ok((select attnotnull from pg_attribute where attrelid = 'public.homework'::regclass and attname = 'course_id'),
  'AC13 homework.course_id is not null');
select t.throws($$insert into homework (student_id, title) values ('00000000-0000-0000-0000-0000000000c1', 'x')$$, '23502',
  'AC13 homework without a course is rejected (even for the superuser)');

-- AC 1 / AC 5: submit only to courses you are a listener of.
select t.login('S1');
select t.lives($$insert into homework (id, student_id, course_id, title, photo_path) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 'S1 in A', '00000000-0000-0000-0000-0000000000c1/f1.jpg')$$,
  'AC1 S1 submits to A (listener)');
select t.lives($$insert into homework (id, student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2', 'S1 in B')$$,
  'AC1 S1 submits to B (listener)');
reset role;
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000000d3', 'Chemistry', t.id('M'));
insert into storage.objects (bucket_id, name, owner) values ('homework', t.id('S1') || '/f1.jpg', t.id('S1'));
select t.login('S1');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d3', 'not a listener')$$, '42501',
  'AC1 submitting to a course you are not a listener of is rejected');
select t.throws($$insert into homework (student_id, course_id, title, status) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 'pre-checked', 'checked')$$, '42501',
  'AC1 cannot submit homework already checked');
reset role; select t.login('S2');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 'in no course')$$, '42501',
  'AC3 a student in no course cannot submit');

-- AC 2: a mentor who is a listener submits; a mentor who owns but is not a listener cannot; the teacher cannot.
reset role; select t.login('N');
select t.lives($$insert into homework (id, student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'N in A')$$,
  'AC2 mentor N (listener of A) submits to A');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d2', 'N in own B')$$, '42501',
  'AC2 a mentor cannot submit to a course they own but are not a listener of');
reset role; select t.login('T');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'teacher hw')$$, '42501',
  'roles: the teacher cannot submit homework');

-- AC 5: removed from a course (ARU-7) -> can no longer submit to it.
reset role; select t.login('M');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1')$$,
  'AC5 S1 removed from B');
reset role; select t.login('S1');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2', 'after removal')$$, '42501',
  'AC5 a removed listener cannot submit to that course');

-- Seeing (decision: mentors see all).
select t.eq((select count(*) from homework), 1::bigint, 'see: S1 sees only own homework (A; B was deleted on removal)');
reset role; select t.login('S2');
select t.eq((select count(*) from homework), 0::bigint, 'see: S2 sees nothing');
reset role; select t.login('M');
select t.eq((select count(*) from homework), 2::bigint, 'see: owner M sees all homework');
reset role; select t.login('M2');
select t.eq((select count(*) from homework), 2::bigint, 'see: mentor M2 (owns nothing) sees all homework');
reset role; select t.login('T');
select t.eq((select count(*) from homework), 2::bigint, 'AC10 the teacher sees all homework');
reset role; select t.login(null);
select t.eq((select count(*) from homework), 0::bigint, 'roles: anon sees no homework');

-- Photos follow the homework row.
reset role; select t.login('M2');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/f1.jpg'), 1::bigint, 'photos: any mentor can open the photo');
reset role; select t.login('S2');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/f1.jpg'), 0::bigint, 'photos: another student cannot open it');
reset role; select t.login('S1');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/f1.jpg'), 1::bigint, 'photos: the submitter can open it');

-- Checking: any mentor or the teacher, never your own; only the check columns.
reset role; select t.login('M2');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b3', checked_at = now(), mentor_comment = 'ok' where id = '00000000-0000-0000-0000-0000000000f1'$$), 1::bigint,
  'check: a mentor who does not own the course checks it (decision)');
select t.throws($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000f3'$$, '42501',
  'check: cannot check in someone else''s name');
select t.throws($$update homework set title = 'rewritten' where id = '00000000-0000-0000-0000-0000000000f3'$$, '42501',
  'check: a checker cannot change the title (column privilege)');
select t.throws($$update homework set course_id = '00000000-0000-0000-0000-0000000000d3' where id = '00000000-0000-0000-0000-0000000000f3'$$, '42501',
  'check: a checker cannot move homework to another course');
reset role; select t.login('N');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000f3'$$), 0::bigint,
  'AC9 a mentor cannot check their own homework');
reset role; select t.login('T');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000a1', checked_at = now() where id = '00000000-0000-0000-0000-0000000000f3'$$), 1::bigint,
  'AC10 the teacher checks homework in a course they do not own');
reset role; select t.login('S1');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000c1'$$), 0::bigint,
  'roles: a student cannot check homework');

-- AC 12: profiles.mentor_id grants nothing beyond the mentor rules (M2 is S2's mentor_id; S2 has no homework anyway).
reset role;
select t.ok(not exists (select 1 from pg_policies where tablename = 'homework' and (qual ilike '%is_my_student%' or with_check ilike '%is_my_student%')),
  'AC12 no homework policy uses is_my_student / mentor_id');
select t.ok(not exists (select 1 from pg_policies where schemaname = 'storage' and (qual ilike '%is_my_student%' or with_check ilike '%is_my_student%')),
  'AC12 no storage policy uses is_my_student / mentor_id');

-- owns_course() for ARU-9 / ARU-10.
select t.login('M');
select t.ok(owns_course('00000000-0000-0000-0000-0000000000d1'), 'owns_course: M owns A');
select t.ok(not owns_course('00000000-0000-0000-0000-0000000000d2'), 'owns_course: M does not own B');
reset role; select t.login(null);
select t.throws($$select owns_course('00000000-0000-0000-0000-0000000000d1')$$, '42501', 'roles: anon cannot execute owns_course');

-- ARU-7 still works on top: removing a listener deletes their homework and (with the photo rules) the photo.
reset role; select t.login('M2');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'homework' and name in (select photo_path from listener_homework_photos('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1') where photo_path is not null)$$), 1::bigint,
  'ARU-7 regression: a mentor deletes the listener''s photo');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$,
  'ARU-7 regression: remove_listener still works');
reset role;
select t.ok(not exists (select 1 from homework where student_id = t.id('S1')), 'ARU-7 regression: S1''s homework is gone');
