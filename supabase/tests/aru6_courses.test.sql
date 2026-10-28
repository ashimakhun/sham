-- ARU-6: teachers and mentors create courses; students submit homework for a course.
-- Access rules under test: supabase/migrations/0003_courses.sql (+ unchanged 0001 homework rules).
select t.seed();

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

-- AC 7: course homework follows the existing homework visibility.
reset role; select t.login('S1');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'AC7 student sees own homework in a course');
reset role; select t.login('S2');
select t.eq((select count(*) from homework where course_id = t.id('A')), 0::bigint, 'AC7 student does not see others'' homework');
reset role; select t.login('M');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'AC7 mentor sees own students'' homework');
reset role; select t.login('M2');
select t.eq((select count(*) from homework where course_id = t.id('A')), 0::bigint, 'AC7 mentor does not see other mentors'' students');
reset role; select t.login('T');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'AC7 teacher sees all homework');

-- AC 8/9/10: homework must name an existing course.
reset role; select t.login('S2');
select t.lives($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 'Fractions')$$,
  'AC9 student submits homework for a course');
select t.eq((select course_id from homework where title = 'Fractions'), t.id('A'), 'AC9 homework is saved with its course');
select t.throws($$insert into homework (student_id, title) values ('00000000-0000-0000-0000-0000000000c2', 'No course')$$, '42501',
  'AC8 homework without a course is rejected');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000ffff', 'Ghost')$$, '42501',
  'AC8 homework for a course that does not exist is rejected');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 'Impersonated')$$, '42501',
  'student cannot submit homework as another student');
reset role; select t.login('M');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'Mentor hw')$$, '42501',
  'roles: mentor cannot submit homework');
reset role; select t.login('T');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'Teacher hw')$$, '42501',
  'roles: teacher cannot submit homework');

-- Duplicate id on retry is rejected (the app treats 23505 as "already saved").
reset role; select t.login('S2');
select t.throws($$insert into homework (id, student_id, course_id, title) values ((select id from homework where title = 'Fractions'), '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 'Fractions')$$, '23505',
  'edge: retrying homework with the same id cannot save twice');
reset role; select t.login('M2');
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-00000000aaaa', 'Retry', t.id('M2'));
select t.throws($$insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-00000000aaaa', 'Retry', '00000000-0000-0000-0000-0000000000b3')$$, '23505',
  'edge: retrying a course with the same id cannot save twice');

-- AC 11: homework from before courses is still visible to the student and their mentor.
reset role; select t.login('S1');
select t.ok(exists (select 1 from homework where id = t.id('HW_OLD') and course_id is null), 'AC11 student still sees legacy homework');
reset role; select t.login('M');
select t.ok(exists (select 1 from homework where id = t.id('HW_OLD')), 'AC11 mentor still sees legacy homework');

-- AC 11/12: checking is unchanged — only the student's assigned mentor (profiles.mentor_id).
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b1', checked_at = now() where id = '00000000-0000-0000-0000-0000000000e4'$$), 1::bigint,
  'AC11 assigned mentor checks legacy homework (no course)');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b1', checked_at = now() where id = '00000000-0000-0000-0000-0000000000e1'$$), 1::bigint,
  'AC12 assigned mentor checks course homework');
reset role; select t.login('N');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000e3'$$), 0::bigint,
  'AC12 the course owner who is not the assigned mentor cannot check (unchanged until ARU-14)');
reset role; select t.login('T');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000000e3'$$), 0::bigint,
  'AC12 teacher cannot check homework (unchanged)');
