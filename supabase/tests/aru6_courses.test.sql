-- ARU-6: teachers and mentors create courses; students submit homework for a course.
-- Access rules under test: supabase/migrations/0003_courses.sql (+ unchanged 0001 homework rules).
select t.seed();
select t.make_assignments(t.id('A')); -- ARU-32: homework is sent for an assignment

-- AC 2 / roles: a teacher and a mentor create courses as themselves.
reset role; select t.login('T');
select t.lives($$insert into courses (title, description, created_by) values ('Teacher course', 'desc', '00000000-0000-0000-0000-0000000000a1')$$,
  'AC2 teacher creates a course with created_by = self');
reset role; select t.login('M2');
select t.lives($$insert into courses (title, created_by) values ('Mentor course', '00000000-0000-0000-0000-0000000000b3')$$,
  'AC2 mentor creates a course with created_by = self (description optional)');
select t.eq((select description from courses where title = 'Mentor course'), '', 'AC2 description defaults to empty');
select t.throws($$insert into courses (title, created_by) values ('Spoofed', '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'AC2 a mentor cannot create a course in someone else''s name');

-- AC 3: blank titles are rejected by the database too.
select t.throws($$insert into courses (title, created_by) values ('   ', '00000000-0000-0000-0000-0000000000b3')$$, '23514',
  'AC3 title of only spaces is rejected');
select t.throws($$insert into courses (title, created_by) values ('', '00000000-0000-0000-0000-0000000000b3')$$, '23514',
  'AC3 empty title is rejected');

-- AC 4: a student cannot create a course, even as themselves.
reset role; select t.login('S1');
select t.throws($$insert into courses (title, created_by) values ('Student course', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'AC4 student creating a course is rejected by RLS');
-- Anonymous users cannot create or read courses.
reset role; select t.login(null);
select t.throws($$insert into courses (title, created_by) values ('Anon', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'anon cannot create a course');
select t.eq((select count(*) from courses), 0::bigint, 'anon sees no courses');

-- Courses have no update/delete in this issue.
reset role; select t.login('M');
select t.eq(t.affected($$update courses set title = 'Hacked' where id = '00000000-0000-0000-0000-0000000000d1'$$), 0::bigint,
  'no update policy: owner cannot edit a course');
select t.eq(t.affected($$delete from courses where id = '00000000-0000-0000-0000-0000000000d1'$$), 0::bigint,
  'no delete policy: owner cannot delete a course');

-- AC 5: courses are published for live updates.
reset role;
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'courses'),
  'AC5 courses is in the supabase_realtime publication');

-- AC 6 / roles: every role sees all courses.
select t.login('S2');
select t.eq((select count(*) from courses), 4::bigint, 'AC6 student sees all courses');
reset role; select t.login('M2');
select t.eq((select count(*) from courses), 4::bigint, 'AC6 mentor sees all courses');
reset role; select t.login('T');
select t.eq((select count(*) from courses), 4::bigint, 'AC6 teacher sees all courses');

-- AC 7: course homework follows the homework visibility (since ARU-14: own for students, all for mentors/teacher).
reset role; select t.login('S1');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'AC7 student sees own homework in a course');
reset role; select t.login('S2');
select t.eq((select count(*) from homework where course_id = t.id('A')), 0::bigint, 'AC7 student does not see others'' homework');
reset role; select t.login('M');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'AC7 mentor sees the course homework');
reset role; select t.login('M2');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'AC7 (changed by ARU-14) any mentor sees course homework');
reset role; select t.login('T');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'AC7 teacher sees all homework');

-- AC 8/9/10: homework must name an existing course (and, since ARU-14, one the student is a listener of).
reset role;
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S2'), t.id('M'));
select t.login('S2');
select t.lives($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 'Fractions', t.assignment('00000000-0000-0000-0000-0000000000d1', 1))$$,
  'AC9 student submits homework for a course');
select t.eq((select course_id from homework where title = 'Fractions'), t.id('A'), 'AC9 homework is saved with its course');
select t.throws($$insert into homework (student_id, title) values ('00000000-0000-0000-0000-0000000000c2', 'No course')$$, '42501',
  'AC8 homework without a course is rejected');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000ffff', 'Ghost', t.assignment('00000000-0000-0000-0000-0000000000d1', 2))$$, '42501',
  'AC8 homework for a course that does not exist is rejected');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 'Impersonated', t.assignment('00000000-0000-0000-0000-0000000000d1', 3))$$, '42501',
  'student cannot submit homework as another student');
reset role; select t.login('M');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'Mentor hw', t.assignment('00000000-0000-0000-0000-0000000000d1', 4))$$, '42501',
  'roles: mentor cannot submit homework');
reset role; select t.login('T');
select t.throws($$insert into homework (student_id, course_id, title, assignment_id) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'Teacher hw', t.assignment('00000000-0000-0000-0000-0000000000d1', 5))$$, '42501',
  'roles: teacher cannot submit homework');

-- Duplicate id on retry is rejected (the app treats 23505 as "already saved").
reset role; select t.login('S2');
select t.throws($$insert into homework (id, student_id, course_id, title, assignment_id) values ((select id from homework where title = 'Fractions'), '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 'Fractions', t.assignment('00000000-0000-0000-0000-0000000000d1', 1))$$, '23505',
  'edge: retrying homework with the same id cannot save twice');
reset role; select t.login('M2');
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-00000000aaaa', 'Retry', t.id('M2'));
select t.throws($$insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-00000000aaaa', 'Retry', '00000000-0000-0000-0000-0000000000b3')$$, '23505',
  'edge: retrying a course with the same id cannot save twice');

-- AC 11/12 (legacy homework without a course, checking by profiles.mentor_id) were superseded by ARU-14:
-- homework without a course no longer exists and checking follows supabase/tests/aru14_homework_by_course.test.sql.
reset role; select t.login('M');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b1', checked_at = now() where id = '00000000-0000-0000-0000-0000000000e1'$$), 1::bigint,
  'AC12 a mentor checks course homework');
