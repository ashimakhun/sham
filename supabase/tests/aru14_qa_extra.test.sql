-- ARU-14 QA additions to aru14_homework_by_course.test.sql: column limits on updates, impersonation,
-- retries and anon access to photos. Rules under test: supabase/migrations/0005_homework_by_course.sql.
select t.seed();
delete from homework;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('N'), t.id('M'));
insert into homework (id, student_id, course_id, title, photo_path) values
  (t.id('HW_A1'), t.id('S1'), t.id('A'), 'S1 in A', t.id('S1') || '/a1.jpg'),
  (t.id('HW_A2'), t.id('N'), t.id('A'), 'N in A', null);

-- The submitter cannot edit their homework afterwards (out of scope: editing submitted homework).
select t.login('S1');
select t.throws($$update homework set title = 'edited' where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501',
  'a student cannot edit submitted homework');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000c1' where id = '00000000-0000-0000-0000-0000000000e1'$$), 0::bigint,
  'AC9 a student cannot check their own homework');

-- A checker may change only the check columns.
reset role; select t.login('M');
select t.throws($$update homework set student_id = '00000000-0000-0000-0000-0000000000c2' where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501',
  'a checker cannot change who submitted the homework');
select t.throws($$update homework set photo_path = null where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501',
  'a checker cannot change the photo');
select t.throws($$update homework set description = 'x' where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501',
  'a checker cannot change the description');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = '00000000-0000-0000-0000-0000000000b1', checked_at = now(), mentor_comment = 'Good' where id = '00000000-0000-0000-0000-0000000000e1'$$), 1::bigint,
  'AC6 owner M checks with a comment');
reset role;
select t.eq((select mentor_comment from homework where id = t.id('HW_A1')), 'Good', 'AC6 the comment is saved');

-- Submitting: never as someone else; a retry with the same id cannot save twice.
select t.login('N');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 'as S1')$$, '42501',
  'a listener cannot submit in someone else''s name');
select t.lives($$insert into homework (id, student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'retry')$$,
  'mentor listener N submits');
select t.throws($$insert into homework (id, student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'retry')$$, '23505',
  'edge: a retry with the same id cannot save twice');

-- AC 8 (superseded by the decision) still keeps students out of others' homework and photos.
reset role; select t.login('S2');
select t.eq((select count(*) from homework), 0::bigint, 'a student in no course sees no homework');
select t.eq((select count(*) from storage.objects where bucket_id = 'homework'), 0::bigint, 'a student sees no one else''s photos');
reset role; select t.login(null);
select t.eq((select count(*) from storage.objects where bucket_id = 'homework'), 0::bigint, 'anon sees no homework photos');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 'anon')$$, '42501',
  'anon cannot submit homework');

-- Old helper is kept but unused (AC 12, out of scope to drop).
reset role;
select t.ok(exists (select 1 from pg_proc where proname = 'is_my_student'), 'is_my_student() is kept (no schema loss)');
select t.ok(exists (select 1 from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'mentor_id' and not attisdropped),
  'profiles.mentor_id is kept (no schema loss)');
select t.ok(col_description('public.homework'::regclass, (select attnum from pg_attribute where attrelid = 'public.homework'::regclass and attname = 'student_id')) ilike 'Submitted by%',
  'homework.student_id has the "submitted by" comment');
