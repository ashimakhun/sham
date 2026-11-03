-- QA ARU-85: gaps in aru85_delete_course.test.sql: a null course id, the course-only PDF of a deleted course becoming
-- visible to every approved user (edge case, 0020/0021 rule) while its file stays in Storage, the teacher's new
-- homework policy not reaching the materials bucket, the discipline staying, a listener's other course untouched,
-- and the owner no longer counting as a course owner afterwards.
-- Fixture: A (owner M, discipline D, listener S1, course-only PDF by M), B (owner N, listener S1).
select t.seed();
insert into disciplines (id, name, created_by) values (md5('aru85qa-d')::uuid, 'Maths', t.id('T'));
update courses set discipline_id = md5('aru85qa-d')::uuid where id in (t.id('A'), t.id('B'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('B'), t.id('S1'), t.id('N'));
insert into material_files (id, author_id, name, course_id, course_only, storage_path, size_bytes) values
  (md5('aru85qa-pdf')::uuid, t.id('M'), 'A only', t.id('A'), true, t.id('M') || '/' || md5('aru85qa-pdf')::uuid || '.pdf', 100);
insert into storage.objects (bucket_id, name, owner) values
  ('materials', t.id('M') || '/' || md5('aru85qa-pdf')::uuid || '.pdf', t.id('M'));

-- Before: S2 (not in A) can't see the course-only PDF.
select t.login('S2');
select t.eq((select count(*) from material_files where id = md5('aru85qa-pdf')::uuid), 0::bigint,
  'before: a course-only PDF is hidden from a non-listener');
reset role;

-- Null id, and the teacher's homework policy doesn't reach other buckets.
select t.login('T');
select t.throws($$select delete_course(null)$$, 'P0002', 'a null course id: Course not found');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials'$$), 0::bigint,
  'the teacher''s new Storage policy is for homework only: no materials file can be deleted through it');
select t.lives($$select delete_course(t.id('A'))$$, 'the teacher deletes A');
reset role;

-- The PDF stays, with no course, and is now visible to every approved user (accepted edge case); its file stays.
select t.eq((select course_id from material_files where id = md5('aru85qa-pdf')::uuid), null::uuid, 'AC6 the PDF has no course');
select t.login('S2');
select t.eq((select count(*) from material_files where id = md5('aru85qa-pdf')::uuid), 1::bigint,
  'edge: the course-only PDF of a deleted course is visible to everyone');
reset role;
select t.eq((select count(*) from storage.objects where bucket_id = 'materials'), 1::bigint, 'AC6 the PDF''s file stays in Storage');

-- The discipline and S1's other course stay; S1 is still a listener of B.
select t.eq((select count(*) from disciplines where id = md5('aru85qa-d')::uuid), 1::bigint, 'AC6 the discipline stays');
select t.eq((select count(*) from course_members where user_id = t.id('S1')), 1::bigint, 'AC6 S1 is still a listener of B');
select t.login('S1');
select t.eq((select count(*) from courses where id = t.id('A')), 0::bigint, 'AC7 the listener no longer reads A');
select t.eq((select count(*) from chat_unread_counts() where course_id = t.id('A')), 0::bigint, 'AC7 no unread counter for A');
reset role;

-- The owner M owns nothing now: switching M to student is allowed (0007 rule, as for ARU-75's account deletion).
select t.login('T');
select t.lives(format('select set_user_role(%L, %L)', t.id('M'), 'student'), 'edge: the former owner can now be made a student');
reset role;
