-- ARU-9 QA additions (revised TEST DESIGN, 13:09): access is unchanged by an owner change made through the RPC,
-- for every role (AC 8/12); the chat moves with the owner (ARU-8 regression); more AC 14 paths.
-- Rules under test: supabase/migrations/0007_course_owner.sql on top of 0005 (homework) and 0006 (chat).
-- Course C = A (owned by M). L = M2 (mentor listener of A); S = S1 (listener of A).
select t.seed();
delete from homework;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.id('S1'), t.id('M'));
insert into homework (id, student_id, course_id, title, status, checked_by, checked_at, mentor_comment) values
  (t.id('HW_A1'), t.id('S1'), t.id('A'), 'S unchecked', 'submitted', null, null, null),
  (t.id('HW_A2'), t.id('S1'), t.id('A'), 'S checked', 'checked', t.id('M'), '2026-10-01T10:00:00Z', 'Good'),
  (t.id('HW_B1'), t.id('M2'), t.id('A'), 'L own', 'submitted', null, null, null);
insert into course_messages (course_id, author_id, body) values (t.id('A'), t.id('M'), 'Welcome from M');
create temp table hw_before as select * from homework;
grant select on hw_before to authenticated;

-- The change goes through the RPC, as the app does it (listener-mentor L hands A from M to N).
select t.login('M2');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2')$$,
  'setup: listener-mentor L hands A from M to N through the RPC');

-- AC 10: no homework row changed.
reset role;
select t.ok(not exists (select * from homework except select * from hw_before) and not exists (select * from hw_before except select * from homework),
  'AC10 the RPC owner change updates no homework row (checked one keeps checker, time and comment)');

-- AC 8 / AC 12: the same people see and check C's homework after the change, never their own.
select t.login('M');
select t.eq((select count(*) from homework where course_id = t.id('A')), 3::bigint, 'AC8 former owner M still sees all of A''s homework');
reset role; select t.login('N');
select t.eq((select count(*) from homework where course_id = t.id('A')), 3::bigint, 'AC8 new owner N sees all of A''s homework');
reset role; select t.login('M2');
select t.eq((select count(*) from homework where course_id = t.id('A')), 3::bigint, 'AC12 listener-mentor L still sees all of A''s homework');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b3' where id = '00000000-0000-0000-0000-0000000000e3'$$), 0::bigint,
  'AC12 L still cannot check their own homework');
reset role; select t.login('S1');
select t.eq((select count(*) from homework), 2::bigint, 'AC8 student S still sees only their own homework');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000c1' where id = '00000000-0000-0000-0000-0000000000e1'$$), 0::bigint,
  'AC8 student S still cannot check');
reset role; select t.login('M');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b1', checked_at = now(), mentor_comment = 'by M' where id = '00000000-0000-0000-0000-0000000000e1'$$), 1::bigint,
  'AC8 former owner M can still check S''s unchecked homework');
reset role; select t.login('T');
select t.eq((select count(*) from homework where course_id = t.id('A')), 3::bigint, 'AC12 the teacher still sees all of A''s homework');
select t.eq(t.affected($$update homework set mentor_comment = 'teacher note', checked_by = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000000e1'$$), 1::bigint,
  'AC12 the teacher can still check in A');

-- AC 11 (data): a listener reads A's new owner as their mentor.
reset role; select t.login('S1');
select t.eq((select p.full_name from courses c join profiles p on p.id = c.created_by where c.id = t.id('A')), 'Mentor Nina',
  'AC11 S reads N as A''s owner (mentor) after the change');

-- ARU-8 regression: the chat follows the owner. N gains it, M (not a listener) loses it, L and S keep it.
reset role; select t.login('N');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 1::bigint, 'ARU-8 new owner N reads A''s chat history');
select t.lives($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', 'Hi from N')$$,
  'ARU-8 new owner N posts in A''s chat');
reset role; select t.login('M');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 0::bigint, 'ARU-8 former owner M (not a listener) no longer reads A''s chat');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'still here?')$$, '42501',
  'ARU-8 former owner M can no longer post in A''s chat');
reset role; select t.login('S1');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 2::bigint, 'ARU-8 listener S keeps the chat, including M''s old message');

-- AC 14: more paths.
reset role; select t.login('S1');
select t.throws($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'AC14 a student cannot make themselves owner through the RPC');
reset role; select t.login('T');
select t.throws($$insert into courses (title, created_by) values ('Teacher spoof', '00000000-0000-0000-0000-0000000000c2')$$, '23514',
  'AC14 app: the teacher cannot create a course owned by a student (the owner trigger fires before RLS)');
reset role;
-- The teacher owns a course and can't be made a student either (same trigger).
update courses set created_by = t.id('T') where id = t.id('B');
select t.throws($$update profiles set role = 'student' where id = '00000000-0000-0000-0000-0000000000a1'$$, '23514',
  'AC14 the teacher who owns a course cannot be made a student');
-- A former owner who owns nothing any more can be made a student.
select t.lives($$update profiles set role = 'student' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  'AC14 former owner M, who now owns nothing, can be made a student');
select t.throws($$update courses set created_by = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000d1'$$, '23514',
  'AC14 and a course cannot be moved to them while they are a student');
select t.eq((select count(*) from courses c join profiles p on p.id = c.created_by where p.role = 'student'), 0::bigint,
  'AC14 no course is owned by a student at the end');

-- Data: trigger functions are not callable by app users.
select t.login('M2');
select t.throws($$select courses_owner_is_staff()$$, '42501', 'data: app users cannot call the courses trigger function');
