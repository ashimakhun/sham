-- ARU-83: the teacher deletes a discipline with every course in it. Functions under test:
-- supabase/migrations/0042_delete_discipline.sql (reusing 0041's delete_course() and course_homework_photos()).
-- D1 holds A (owner M), B (owner N) and a hidden course H; D2 is empty; D3 is hidden; C has no discipline and E is in
-- another discipline (controls). A has a removed listener's photo; B has a listener, feedback and billing.
select t.seed();
select t.make_assignments(t.id('A'));

set session_replication_role = replica;
insert into disciplines (id, name, created_by) values
  (md5('aru83-d1')::uuid, 'Math', t.id('T')),
  (md5('aru83-d2')::uuid, 'Art', t.id('T')),
  (md5('aru83-other')::uuid, 'Other', t.id('T'));
insert into disciplines (id, name, hidden, created_by) values (md5('aru83-d3')::uuid, 'Secret', true, t.id('T'));
update courses set discipline_id = md5('aru83-d1')::uuid where id in (t.id('A'), t.id('B'));
insert into courses (id, title, created_by, hidden, discipline_id) values
  (md5('aru83-h')::uuid, 'Hidden', t.id('M'), true, md5('aru83-d1')::uuid),
  (md5('aru83-d3c')::uuid, 'Secret course', t.id('M'), true, md5('aru83-d3')::uuid);
insert into courses (id, title, created_by) values (md5('aru83-c')::uuid, 'No discipline', t.id('N'));
insert into courses (id, title, created_by, discipline_id) values (md5('aru83-e')::uuid, 'Elsewhere', t.id('N'), md5('aru83-other')::uuid);
insert into course_members (course_id, user_id, added_by) values
  (t.id('B'), t.id('S1'), t.id('N')),
  (md5('aru83-c')::uuid, t.id('S1'), t.id('N'));
insert into homework (id, student_id, course_id, assignment_id, title, photo_path, status) values
  (md5('aru83-s2')::uuid, t.id('S2'), t.id('A'), t.assignment(t.id('A'), 1), 'Removed listener', t.id('S2') || '/s2.jpg', 'submitted'),
  (md5('aru83-c-hw')::uuid, t.id('S1'), md5('aru83-c')::uuid, null, 'C keeps', t.id('S1') || '/c.jpg', 'submitted');
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.id('S2') || '/s2.jpg', t.id('S2')),
  ('homework', t.id('S1') || '/c.jpg', t.id('S1'));
insert into course_messages (course_id, author_id, body) values (t.id('B'), t.id('S1'), 'hi');
insert into course_feedback (course_id, user_id, rating, body) values (t.id('B'), t.id('S1'), 5, 'Great');
insert into course_billing (course_id, start_day, end_day, selected_by) values (t.id('B'), 1, 10, t.id('T'));
insert into material_files (id, author_id, name, course_id, course_only, storage_path, size_bytes) values
  (md5('aru83-pdf')::uuid, t.id('M'), 'A notes', t.id('A'), true, t.id('M') || '/' || md5('aru83-pdf')::uuid || '.pdf', 100);
set session_replication_role = origin;

-- Access: only the teacher; a mentor who owns a course in it too gets 42501.
select t.login('M');
select t.throws($$select delete_discipline(md5('aru83-d1')::uuid)$$, '42501', 'a mentor owning a course in it can''t delete');
select t.throws($$select * from discipline_homework_photos(md5('aru83-d1')::uuid)$$, '42501', 'a mentor can''t list its photos');
reset role; select t.login('S1');
select t.throws($$select delete_discipline(md5('aru83-d1')::uuid)$$, '42501', 'a student can''t delete');
select t.throws($$select * from discipline_homework_photos(md5('aru83-d1')::uuid)$$, '42501', 'a student can''t list its photos');
reset role; select t.login(null);
select t.throws($$select delete_discipline(md5('aru83-d1')::uuid)$$, '42501', 'anon can''t delete');
reset role; select t.login('M');
select t.eq(t.affected($$delete from disciplines where id = md5('aru83-d1')::uuid$$), 0::bigint, 'no direct delete on disciplines');
reset role; select t.login('T');
select t.eq(t.affected($$delete from disciplines where id = md5('aru83-d1')::uuid$$), 0::bigint,
  'no direct delete on disciplines for the teacher either');
reset role;
select t.eq((select count(*) from courses where discipline_id = md5('aru83-d1')::uuid), 3::bigint, 'nothing deleted after refusals');

select t.login('T');
select t.throws($$select delete_discipline('00000000-0000-0000-0000-00000000ffff')$$, 'P0002', 'unknown discipline: not found');
select t.throws($$select * from discipline_homework_photos('00000000-0000-0000-0000-00000000ffff')$$, 'P0002',
  'unknown discipline: no photo list');

-- Photos of all its courses still in Storage, a removed listener's included; not C's.
select t.eq((select array_agg(photo_path order by photo_path) from discipline_homework_photos(md5('aru83-d1')::uuid)),
  array[t.id('S1') || '/a1.jpg', t.id('S1') || '/b1.jpg', t.id('S2') || '/s2.jpg'], 'lists every photo of A and B');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'homework'
  and name in (select photo_path from discipline_homework_photos(md5('aru83-d1')::uuid))$$), 3::bigint,
  'the teacher removes all of them');
select t.eq((select count(*) from discipline_homework_photos(md5('aru83-d1')::uuid)), 0::bigint, 'none left to list');

select t.lives($$select delete_discipline(md5('aru83-d1')::uuid)$$, 'the teacher deletes D1');
reset role;
select t.eq((select count(*) from disciplines where id = md5('aru83-d1')::uuid), 0::bigint, 'AC4 discipline gone');
select t.eq((select count(*) from courses where id in (t.id('A'), t.id('B'), md5('aru83-h')::uuid)), 0::bigint,
  'AC4 its courses gone, the hidden one too');
select t.eq((select count(*) from homework where course_id in (t.id('A'), t.id('B'))), 0::bigint, 'AC5 homework gone');
select t.eq((select count(*) from course_members where course_id = t.id('B')), 0::bigint, 'AC5 listeners gone');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 0::bigint, 'AC5 meetings gone');
select t.eq((select count(*) from homework_assignments where course_id = t.id('A')), 0::bigint, 'AC5 assignments gone');
select t.eq((select count(*) from course_messages where course_id = t.id('B')), 0::bigint, 'AC5 chat gone');
select t.eq((select count(*) from course_feedback where course_id = t.id('B')), 0::bigint, 'AC5 feedback gone');
select t.eq((select count(*) from course_billing where course_id = t.id('B')), 0::bigint, 'AC5 billing gone');
select t.eq((select course_id from material_files where id = md5('aru83-pdf')::uuid), null::uuid, 'AC6 PDF stays with No course');
select t.eq((select count(*) from courses where id in (md5('aru83-c')::uuid, md5('aru83-e')::uuid)), 2::bigint,
  'AC6 the no-discipline course and the other discipline''s course stay');
select t.eq((select count(*) from homework where id = md5('aru83-c-hw')::uuid), 1::bigint, 'AC6 their homework stays');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/c.jpg'), 1::bigint, 'AC6 their photo stays');
select t.eq((select count(*) from disciplines where id = md5('aru83-other')::uuid), 1::bigint, 'AC6 other disciplines stay');

-- Retry: P0002, which the app counts as done.
select t.login('T');
select t.throws($$select delete_discipline(md5('aru83-d1')::uuid)$$, 'P0002', 'AC8 a retry finds Discipline not found');

-- An empty discipline and a hidden discipline with a hidden course.
select t.eq((select count(*) from discipline_homework_photos(md5('aru83-d2')::uuid)), 0::bigint, 'empty discipline: no photos');
select t.lives($$select delete_discipline(md5('aru83-d2')::uuid)$$, 'an empty discipline is deleted');
select t.lives($$select delete_discipline(md5('aru83-d3')::uuid)$$, 'a hidden discipline is deleted');
reset role;
select t.eq((select count(*) from disciplines where id in (md5('aru83-d2')::uuid, md5('aru83-d3')::uuid)), 0::bigint,
  'D2 and D3 gone');
select t.eq((select count(*) from courses where id = md5('aru83-d3c')::uuid), 0::bigint, 'D3''s hidden course gone');
