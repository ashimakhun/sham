-- ARU-40: hidden courses. Rules under test: supabase/migrations/0019_hidden_courses.sql.
-- Fixture (t.seed): teacher T; mentors M, N, M2; students S1, S2, S3; visible courses A (owner M), B (owner N).
-- Hidden course H: owner M, listeners M2 (mentor) and S1 (student). N (mentor) and S2 (student) are not in H.
-- H has 5 completed meetings with assignments (t.make_assignments), notes on the first, S1's homework with a photo,
-- S1's attendance and chat messages.
select t.seed();

-- AC 11: existing courses stay visible.
select t.eq((select count(*) from courses where hidden), 0::bigint, 'AC11 existing courses are not hidden');
select t.ok((select is_nullable = 'NO' and column_default = 'false' from information_schema.columns
  where table_name = 'courses' and column_name = 'hidden'), 'AC11 hidden is not null, default false');

create function t.h() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000d7'::uuid $$;
create function t.hm() returns uuid language sql immutable as $$ select md5('meeting' || t.h()::text || '1')::uuid $$;
create function t.hw() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000004e1'::uuid $$;
grant execute on function t.h(), t.hm(), t.hw() to anon, authenticated;

-- AC 1: a mentor creates a hidden course; a student can't create any course.
select t.login('M');
select t.lives($$insert into courses (id, title, created_by, hidden) values (t.h(), 'Secret', t.id('M'), true)$$,
  'AC1 mentor creates a hidden course');
select t.login('T');
select t.lives($$insert into courses (id, title, created_by, hidden)
  values ('00000000-0000-0000-0000-0000000000d8', 'Teacher secret', t.id('T'), true)$$, 'AC1 teacher creates a hidden course');
select t.lives($$insert into courses (id, title, created_by)
  values ('00000000-0000-0000-0000-0000000000d9', 'Open', t.id('T'))$$, 'AC1 switch off: a visible course, as today');
select t.login('S1');
select t.throws($$insert into courses (title, created_by, hidden) values ('Mine', t.id('S1'), true)$$, '42501',
  'AC1 a student cannot create a hidden course');
select t.login('N');
select t.throws($$insert into courses (title, created_by, hidden) values ('Fake', t.id('M'), true)$$, '42501',
  'AC1 nobody creates a hidden course for someone else');

-- Content (as the admin, the way the app would have built it up).
reset role;
insert into course_members (course_id, user_id, added_by) values (t.h(), t.id('M2'), t.id('M')), (t.h(), t.id('S1'), t.id('M'));
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S2'), t.id('M'));
select t.make_assignments(t.h());
update course_meetings set notes = 'Secret notes' where id = t.hm();
insert into homework (id, student_id, course_id, assignment_id, title, photo_path)
  values (t.hw(), t.id('S1'), t.h(), t.assignment(t.h(), 1), 'Hidden homework', t.id('S1') || '/h1.jpg');
insert into storage.objects (bucket_id, name, owner) values ('homework', t.id('S1') || '/h1.jpg', t.id('S1'));
insert into meeting_attendance (meeting_id, user_id) values (t.hm(), t.id('S1'));
insert into course_messages (course_id, author_id, body) values (t.h(), t.id('M'), 'Hello hidden');
insert into course_chat_reads (course_id, user_id, last_read_at) values (t.h(), t.id('S1'), now());

-- AC 2 / AC 6: participants and the teacher see the course and its content.
select t.login('M');
select t.ok(exists (select 1 from courses where id = t.h()), 'AC2 the owner sees H');
select t.eq((select count(*) from course_meetings where course_id = t.h()), 5::bigint, 'AC6 the owner sees H''s meetings');
select t.eq((select count(*) from homework where course_id = t.h()), 1::bigint, 'AC6 the owner (mentor) sees H''s homework');
select t.login('M2');
select t.ok(exists (select 1 from courses where id = t.h()), 'AC2 a mentor listener sees H');
select t.eq((select count(*) from course_members where course_id = t.h()), 2::bigint, 'AC6 a mentor listener sees H''s listeners');
select t.eq((select count(*) from course_messages where course_id = t.h()), 1::bigint, 'AC6 a mentor listener reads H''s chat');
select t.login('S1');
select t.ok(exists (select 1 from courses where id = t.h()), 'AC2 a student listener sees H');
select t.eq((select count(*) from homework_assignments where course_id = t.h()), 5::bigint, 'AC6 a student listener sees assignments');
select t.eq((select count(*) from meeting_attendance), 1::bigint, 'AC6 a student listener sees their own attendance');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/h1.jpg'), 1::bigint,
  'AC6 a student listener reads their own homework photo');
select t.login('T');
select t.ok(exists (select 1 from courses where id = t.h()), 'AC2 the teacher sees H');
select t.ok(exists (select 1 from courses where id = '00000000-0000-0000-0000-0000000000d8'), 'AC2 the teacher sees their own hidden course');
select t.eq((select count(*) from course_meetings where course_id = t.h() and notes = 'Secret notes'), 1::bigint,
  'AC6 the teacher reads H''s notes');
select t.eq((select count(*) from homework where course_id = t.h()), 1::bigint, 'AC6 the teacher sees H''s homework');
select t.eq((select count(*) from meeting_attendance), 1::bigint, 'AC6 the teacher sees H''s attendance');
select t.eq((select count(*) from course_messages where course_id = t.h()), 1::bigint, 'AC6 the teacher reads H''s chat');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/h1.jpg'), 1::bigint, 'AC6 the teacher reads the photo');

-- AC 3 / AC 4 / AC 5: non-participants see nothing of H. Visible courses are unchanged (ARU-24).
select t.login('N');
select t.ok(not exists (select 1 from courses where id = t.h()), 'AC3 a non-participant mentor does not see H');
select t.ok(not exists (select 1 from courses where id = '00000000-0000-0000-0000-0000000000d8'),
  'AC3 nor the teacher''s hidden course');
select t.eq((select count(*) from courses), 3::bigint, 'AC3 they still see every visible course (A, B, Open)');
select t.eq((select count(*) from course_members where course_id = t.h()), 0::bigint, 'AC5 no listeners of H');
select t.eq((select count(*) from course_meetings where course_id = t.h()), 0::bigint, 'AC5 no meetings or notes of H');
select t.eq((select count(*) from homework_assignments where course_id = t.h()), 0::bigint, 'AC5 no assignments of H');
select t.eq((select count(*) from homework where course_id = t.h()), 0::bigint, 'AC5 no homework of H');
select t.eq((select count(*) from meeting_attendance), 0::bigint, 'AC5 no attendance of H');
select t.eq((select count(*) from course_messages where course_id = t.h()), 0::bigint, 'AC5 no chat of H');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/h1.jpg'), 0::bigint, 'AC5 no homework photo of H');
select t.eq((select count(*) from course_members where course_id = t.id('A')), 1::bigint, 'regression: listeners of visible A still readable');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'regression: homework of visible A still readable');
select t.ok(not exists (select 1 from chat_unread_counts() where course_id = t.h()), 'AC4 no unread count for H');

select t.login('S2');
select t.ok(not exists (select 1 from courses where id = t.h()), 'AC3 a non-participant student does not see H');
select t.ok(exists (select 1 from courses where id = t.id('B')), 'AC3 ARU-24: a student still sees visible courses they''re not in');
select t.eq((select count(*) from course_members where course_id = t.h()), 0::bigint, 'AC5 student: no listeners of H');
select t.eq((select count(*) from course_meetings where course_id = t.h()), 0::bigint, 'AC5 student: no meetings of H');
select t.eq((select count(*) from homework_assignments where course_id = t.h()), 0::bigint, 'AC5 student: no assignments of H');
select t.eq((select count(*) from course_chat_reads where course_id = t.h()), 0::bigint, 'AC5 student: no read positions of H');

-- AC 5: writes by non-participants.
select t.login('N');
select t.throws($$insert into course_members (course_id, user_id, added_by) values (t.h(), t.id('S2'), t.id('N'))$$, '42501',
  'AC5 a non-participant mentor cannot add listeners');
select t.throws($$insert into course_messages (course_id, author_id, body) values (t.h(), t.id('N'), 'hi')$$, '42501',
  'AC5 a non-participant cannot post in H''s chat');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values (t.h(), now() + interval '1 day', t.id('N'))$$,
  '42501', 'AC5 a non-participant cannot schedule a meeting');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by)
  values (md5('meeting' || t.h()::text || '2')::uuid, t.h(), 'x', t.id('N'))$$, 'P0002',
  'AC5 assigning homework in H: "Meeting not found."');
select t.throws($$select change_course_owner(t.h(), t.id('N'))$$, 'P0002', 'AC5/AC7 change_course_owner: "Course not found."');
select t.throws($$select set_meeting_status(md5('meeting' || t.h()::text || '2')::uuid, 'canceled')$$, 'P0002',
  'AC5 set_meeting_status: "Meeting not found."');
select t.throws($$select update_meeting(t.hm(), now() + interval '1 day', 'x', null)$$, 'P0002', 'AC5 update_meeting: "Meeting not found."');
-- ARU-142: official notes (set_meeting_notes) are retired; meeting notes are written with add_meeting_listener_notes.
select t.throws($$select add_meeting_listener_notes(t.hm(), 'x')$$, 'P0002', 'AC5 add_meeting_listener_notes: "Meeting not found."');
select t.throws($$select * from listener_homework_photos(t.h(), t.id('S1'))$$, 'P0002',
  'AC5 listener_homework_photos: "Course not found."');
select t.lives($$select remove_listener(t.h(), t.id('S1'))$$, 'AC5 remove_listener raises no error');
select t.throws($$select mark_chat_read(t.h(), (select id from course_messages limit 1))$$, '42501',
  'AC5 mark_chat_read keeps its "not in this course chat" error');
select t.eq(t.affected($$update homework set status = 'checked', checked_by = t.id('N'), checked_at = now() where id = t.hw()$$),
  0::bigint, 'AC5 a non-participant mentor cannot check H''s homework');
select t.eq(t.affected($$delete from storage.objects where name = t.id('S1') || '/h1.jpg'$$), 0::bigint,
  'AC5 a non-participant mentor cannot delete H''s homework photo');
select t.login('S2');
select t.throws($$select mark_attendance(t.hm())$$, 'P0002', 'AC5 mark_attendance: "Meeting not found."');
select t.throws($$select unmark_attendance(t.hm())$$, 'P0002', 'AC5 unmark_attendance: "Meeting not found."');
select t.throws($$insert into homework (student_id, course_id, assignment_id, title) values (t.id('S2'), t.h(), t.assignment(t.h(), 2), 'x')$$,
  '42501', 'AC5 a non-participant student cannot send homework to H');
reset role;
select t.ok(exists (select 1 from course_members where course_id = t.h() and user_id = t.id('S1'))
  and exists (select 1 from homework where id = t.hw()), 'AC5 S1 and their homework are still in H');
select t.eq((select status::text from homework where id = t.hw()), 'submitted', 'AC5 H''s homework is unchecked');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/h1.jpg'), 1::bigint, 'AC5 the photo is still there');

-- AC 6: participants keep their rights.
select t.login('M2');
select t.lives($$update homework set status = 'checked', checked_by = t.id('M2'), checked_at = now() where id = t.hw()$$,
  'AC6 a mentor listener checks H''s homework');
select t.eq((select status::text from homework where id = t.hw()), 'checked', 'AC6 the check is saved');
select t.lives($$insert into course_messages (course_id, author_id, body) values (t.h(), t.id('M2'), 'from M2')$$,
  'AC6 a mentor listener posts in the chat');
select t.lives($$insert into course_members (course_id, user_id, added_by) values (t.h(), t.id('S3'), t.id('M2'))$$,
  'AC6 a mentor listener adds a listener');
select t.login('S1');
select t.lives($$select mark_attendance(md5('meeting' || t.h()::text || '2')::uuid)$$, 'AC6 a student listener marks attendance');
select t.lives($$insert into homework (student_id, course_id, assignment_id, title) values (t.id('S1'), t.h(), t.assignment(t.h(), 2), 'x')$$,
  'AC6 a student listener sends homework');
select t.login('M');
select t.lives($$insert into course_meetings (course_id, starts_at, created_by) values (t.h(), now() + interval '1 day', t.id('M'))$$,
  'AC6 the owner schedules a meeting');
select t.lives($$select add_meeting_listener_notes(t.hm(), 'Owner notes')$$, 'AC6 the owner writes notes (ARU-142)');
select t.login('T');
select t.lives($$select add_meeting_listener_notes(t.hm(), 'Teacher notes')$$, 'AC6 the teacher writes notes in H (ARU-142)');
select t.lives($$insert into course_messages (course_id, author_id, body) values (t.h(), t.id('T'), 'from T')$$,
  'AC6 the teacher posts in H''s chat');

-- AC 8: a new listener gains access; a removed one loses it at once.
select t.login('S3');
select t.ok(exists (select 1 from courses where id = t.h()), 'AC8 the added listener sees H');
select t.login('M2');
select t.lives($$select remove_listener(t.h(), t.id('S3'))$$, 'AC8 a mentor listener removes S3');
select t.login('S3');
select t.ok(not exists (select 1 from courses where id = t.h()), 'AC8 the removed listener no longer sees H');
select t.eq((select count(*) from course_meetings where course_id = t.h()), 0::bigint, 'AC8 nor its meetings');

-- AC 7 / AC 9: owner changes. A mentor listener hands H to N; M (the old owner, not a listener) loses access.
select t.login('M2');
select t.lives($$select change_course_owner(t.h(), t.id('N'))$$, 'AC7 a mentor listener changes the owner');
select t.login('N');
select t.ok(exists (select 1 from courses where id = t.h()), 'AC9 the new owner sees H');
select t.login('M');
select t.ok(not exists (select 1 from courses where id = t.h()), 'AC9 the previous owner loses access');
select t.throws($$select change_course_owner(t.h(), t.id('M'))$$, 'P0002', 'AC9 and can no longer change the owner');
select t.login('M2');
select t.ok(exists (select 1 from courses where id = t.h()), 'AC9 the mentor listener keeps access');
-- The teacher changes it, takes it and gives it back without ever losing access.
select t.login('T');
select t.lives($$select change_course_owner(t.h(), t.id('T'))$$, 'AC7 the teacher takes ownership');
select t.lives($$select change_course_owner(t.h(), t.id('N'))$$, 'AC7 the teacher hands it back');
select t.ok(exists (select 1 from courses where id = t.h()), 'AC9 the teacher never loses access');

-- AC 7: demoting a mentor who owns a hidden course lists it, and works after the teacher reassigns it.
select t.throws($$select set_user_role(t.id('N'), 'student')$$, '23514', 'AC7 demoting the owner of H is refused');
do $$
begin
  perform set_user_role(t.id('N'), 'student');
exception when others then
  perform t.ok(sqlerrm like '%Secret%', 'AC7 the refusal names the hidden course');
end $$;
select t.lives($$select change_course_owner(t.id('B'), t.id('T'))$$, 'AC7 the teacher reassigns B');
select t.lives($$select change_course_owner(t.h(), t.id('T'))$$, 'AC7 the teacher reassigns H');
select t.lives($$select set_user_role(t.id('N'), 'student')$$, 'AC7 then the demotion succeeds');
select t.login('N');
select t.ok(not exists (select 1 from courses where id = t.h()), 'AC7 the demoted ex-owner no longer sees H');
reset role;
