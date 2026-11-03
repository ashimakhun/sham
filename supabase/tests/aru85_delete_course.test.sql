-- ARU-85: the teacher deletes a course with everything in it. Functions and policies under test:
-- supabase/migrations/0041_delete_course.sql.
-- Course A (owner M) gets listeners S1 and S3, five meetings with assignments, attendance, homework with photos (one
-- from S2, a listener who was removed: no membership), chat messages and read positions, feedback, billing, payment
-- marks and a course-only Knowledge base PDF. B (owner N) is the control course. Seeded as the admin, triggers off.
select t.seed();
select t.make_assignments(t.id('A'));
select t.make_assignments(t.id('B'));

set session_replication_role = replica;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M')),
  (t.id('B'), t.id('S1'), t.id('N'));
insert into homework (id, student_id, course_id, assignment_id, title, photo_path, status) values
  (md5('aru85-s2')::uuid, t.id('S2'), t.id('A'), t.assignment(t.id('A'), 1), 'Removed listener', t.id('S2') || '/s2.jpg', 'submitted'),
  (md5('aru85-s3')::uuid, t.id('S3'), t.id('A'), t.assignment(t.id('A'), 2), 'No photo', null, 'submitted'),
  -- Odd row: an assignment of A, but course_id B. It points at A's assignment, so it goes with A.
  (md5('aru85-cross')::uuid, t.id('S3'), t.id('B'), t.assignment(t.id('A'), 3), 'Cross', t.id('S3') || '/cross.jpg', 'submitted'),
  (md5('aru85-b')::uuid, t.id('S1'), t.id('B'), t.assignment(t.id('B'), 1), 'B keeps', t.id('S1') || '/b2.jpg', 'submitted');
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.id('S2') || '/s2.jpg', t.id('S2')),
  ('homework', t.id('S3') || '/cross.jpg', t.id('S3')),
  ('homework', t.id('S1') || '/b2.jpg', t.id('S1'));
insert into meeting_attendance (meeting_id, user_id) values
  (md5('meeting' || t.id('A')::text || '1')::uuid, t.id('S1')),
  (md5('meeting' || t.id('B')::text || '1')::uuid, t.id('S1'));
insert into course_messages (course_id, author_id, body) values (t.id('A'), t.id('S1'), 'hi A'), (t.id('B'), t.id('S1'), 'hi B');
insert into course_chat_reads (course_id, user_id, last_read_at) values (t.id('A'), t.id('S1'), now()), (t.id('B'), t.id('S1'), now());
insert into course_feedback (course_id, user_id, rating, body) values (t.id('A'), t.id('S1'), 5, 'Great'), (t.id('B'), t.id('S1'), 4, 'Good');
insert into course_billing (course_id, start_day, end_day, selected_by) values (t.id('A'), 1, 10, t.id('T')), (t.id('B'), 1, 10, t.id('T'));
insert into course_payments (course_id, user_id, month, marked_by) values (t.id('A'), t.id('S1'), '2026-11-01', t.id('T'));
insert into course_payment_exemptions (course_id, user_id, set_by) values (t.id('A'), t.id('S3'), t.id('T'));
insert into material_files (id, author_id, name, course_id, course_only, storage_path, size_bytes) values
  (md5('aru85-pdf')::uuid, t.id('M'), 'A notes', t.id('A'), true, t.id('M') || '/' || md5('aru85-pdf')::uuid || '.pdf', 100);
insert into courses (id, title, created_by, hidden) values (md5('aru85-hidden')::uuid, 'Hidden', t.id('M'), true);
insert into courses (id, title, created_by) values (md5('aru85-empty')::uuid, 'Empty', t.id('T'));
set session_replication_role = origin;

create table t.b_before as
  select (select count(*) from homework where course_id = t.id('B') and id <> md5('aru85-cross')::uuid) hw,
         (select count(*) from course_members where course_id = t.id('B')) members,
         (select count(*) from course_meetings where course_id = t.id('B')) meetings,
         (select count(*) from homework_assignments where course_id = t.id('B')) assignments,
         (select count(*) from course_messages where course_id = t.id('B')) messages,
         (select count(*) from course_feedback where course_id = t.id('B')) feedback,
         (select count(*) from course_billing where course_id = t.id('B')) billing;
grant select on t.b_before to authenticated;

-- Access: everyone but the approved teacher is refused (42501), the course's owner included, and nothing changes.
select t.login('M');
select t.throws($$select delete_course(t.id('A'))$$, '42501', 'the owning mentor can''t delete the course');
select t.throws($$select * from course_homework_photos(t.id('A'))$$, '42501', 'the owning mentor can''t list its photos');
reset role; select t.login('N');
select t.throws($$select delete_course(t.id('A'))$$, '42501', 'another mentor can''t delete the course');
reset role; select t.login('S1');
select t.throws($$select delete_course(t.id('A'))$$, '42501', 'a listener can''t delete the course');
select t.throws($$select * from course_homework_photos(t.id('A'))$$, '42501', 'a student can''t list its photos');
reset role; select t.login(null);
select t.throws($$select delete_course(t.id('A'))$$, '42501', 'anon can''t call delete_course');
reset role;
-- (A teacher is always approved: profiles_teacher_approved, 0021. my_role() is null for any unapproved account.)
select t.ok(exists (select 1 from courses where id = t.id('A')), 'the course is still there after the refusals');

-- Direct REST deletes stay impossible (no delete policy on courses).
select t.login('T');
select t.eq(t.affected($$delete from courses where id = t.id('A')$$), 0::bigint, 'no direct delete on courses, even for the teacher');
reset role; select t.login('M');
select t.eq(t.affected($$delete from courses where id = t.id('A')$$), 0::bigint, 'no direct delete on courses for the owner');

-- Storage: the new teacher policy doesn't widen mentors' or students' rights.
select t.eq(t.affected($$delete from storage.objects where name = t.id('S2') || '/s2.jpg'$$), 0::bigint,
  'a mentor can''t delete a removed listener''s photo');
reset role; select t.login('S1');
select t.eq(t.affected($$delete from storage.objects where name = t.id('S2') || '/s2.jpg'$$), 0::bigint,
  'a student can''t delete another student''s photo');
reset role;

-- Unknown course: P0002.
select t.login('T');
select t.throws($$select delete_course('00000000-0000-0000-0000-00000000ffff')$$, 'P0002', 'unknown course: Course not found');
select t.throws($$select * from course_homework_photos('00000000-0000-0000-0000-00000000ffff')$$, 'P0002',
  'unknown course: no photo list');

-- The photo list: every photo of A still in Storage, including the removed listener's and the cross row's. A1's
-- seeded photo (S1/a1.jpg) counts too.
select t.eq((select array_agg(photo_path order by photo_path) from course_homework_photos(t.id('A'))),
  array[t.id('S1') || '/a1.jpg', t.id('S2') || '/s2.jpg', t.id('S3') || '/cross.jpg'], 'lists every photo of A');

-- The teacher deletes every photo, including the removed listener's (not covered by 0004's listener policy).
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'homework'
  and name in (select photo_path from course_homework_photos(t.id('A'))) $$), 3::bigint, 'the teacher removes all three photos');
select t.eq((select count(*) from course_homework_photos(t.id('A'))), 0::bigint, 'a photo already gone is no longer listed');

-- Delete.
select t.lives($$select delete_course(t.id('A'))$$, 'the teacher deletes course A');
reset role;
select t.eq((select count(*) from courses where id = t.id('A')), 0::bigint, 'AC5 course gone');
select t.eq((select count(*) from course_members where course_id = t.id('A')), 0::bigint, 'AC5 listeners gone');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 0::bigint, 'AC5 meetings (and notes) gone');
select t.eq((select count(*) from meeting_attendance where meeting_id = md5('meeting' || t.id('A')::text || '1')::uuid), 0::bigint,
  'AC5 attendance gone');
select t.eq((select count(*) from homework_assignments where course_id = t.id('A')), 0::bigint, 'AC5 assignments gone');
select t.eq((select count(*) from homework where course_id = t.id('A')), 0::bigint, 'AC5 homework gone (removed listener''s too)');
select t.eq((select count(*) from homework where id = md5('aru85-cross')::uuid), 0::bigint, 'AC5 homework on an A assignment gone');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 0::bigint, 'AC5 chat messages gone');
select t.eq((select count(*) from course_chat_reads where course_id = t.id('A')), 0::bigint, 'AC5 chat read positions gone');
select t.eq((select count(*) from course_feedback where course_id = t.id('A')), 0::bigint, 'AC5 feedback gone');
select t.eq((select count(*) from course_billing where course_id = t.id('A')), 0::bigint, 'AC5 billing gone');
select t.eq((select count(*) from course_payments where course_id = t.id('A')), 0::bigint, 'AC5 payment marks gone');
select t.eq((select count(*) from course_payment_exemptions where course_id = t.id('A')), 0::bigint, 'AC5 exemptions gone');

-- What stays.
select t.eq((select course_id from material_files where id = md5('aru85-pdf')::uuid), null::uuid, 'AC6 the PDF stays with No course');
select t.ok((select hw = (select count(*) from homework where course_id = t.id('B'))
         and members = (select count(*) from course_members where course_id = t.id('B'))
         and meetings = (select count(*) from course_meetings where course_id = t.id('B'))
         and assignments = (select count(*) from homework_assignments where course_id = t.id('B'))
         and messages = (select count(*) from course_messages where course_id = t.id('B'))
         and feedback = (select count(*) from course_feedback where course_id = t.id('B'))
         and billing = (select count(*) from course_billing where course_id = t.id('B')) from t.b_before),
  'AC6 course B and its data are untouched');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/b2.jpg'), 1::bigint, 'AC6 B''s photo stays');
select t.eq((select count(*) from profiles), 7::bigint, 'AC6 users untouched');

-- Retry after it is gone: P0002, which the app counts as done.
select t.login('T');
select t.throws($$select delete_course(t.id('A'))$$, 'P0002', 'AC8 a retry finds Course not found');
select t.throws($$select * from course_homework_photos(t.id('A'))$$, 'P0002', 'AC8 the photo list on a retry: Course not found');

-- Hidden and empty courses delete the same way.
select t.lives($$select delete_course(md5('aru85-hidden')::uuid)$$, 'a hidden course is deleted');
select t.eq((select count(*) from course_homework_photos(md5('aru85-empty')::uuid)), 0::bigint, 'an empty course has no photos');
select t.lives($$select delete_course(md5('aru85-empty')::uuid)$$, 'an empty course (the teacher''s own) is deleted');
reset role;
select t.eq((select count(*) from courses where id in (md5('aru85-hidden')::uuid, md5('aru85-empty')::uuid)), 0::bigint,
  'hidden and empty courses gone');
