-- QA ARU-40: hidden courses, gaps in the dev tests (aru40_hidden_courses.test.sql).
-- Fixture: t.seed() plus hidden course H owned by M, listeners M2 (mentor) and S1 (student); N (mentor) and S2
-- (student) are not in H. H has five completed meetings with assignments, a sixth completed meeting without one,
-- homework from S1 (with a photo) and M2, S1's attendance and a chat message from M.
select t.seed();

create function t.h() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000f1'::uuid $$;
create function t.hm(n int) returns uuid language sql immutable as $$ select md5('meeting' || t.h()::text || n::text)::uuid $$;
create function t.free() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000f6'::uuid $$;
grant execute on function t.h(), t.hm(int), t.free() to anon, authenticated;

insert into courses (id, title, created_by, hidden) values (t.h(), 'Secret', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values
  (t.h(), t.id('M2'), t.id('M')), (t.h(), t.id('S1'), t.id('M')), (t.id('A'), t.id('S2'), t.id('M'));
select t.make_assignments(t.h());
set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, status, created_by)
  values (t.free(), t.h(), now() - interval '1 hour', 'completed', t.id('M'));
set session_replication_role = origin;
insert into homework (id, student_id, course_id, assignment_id, title, photo_path) values
  ('00000000-0000-0000-0000-0000000000f2', t.id('S1'), t.h(), t.assignment(t.h(), 1), 'S1 hidden', t.id('S1') || '/h.jpg'),
  ('00000000-0000-0000-0000-0000000000f3', t.id('M2'), t.h(), t.assignment(t.h(), 1), 'M2 hidden', null);
insert into storage.objects (bucket_id, name, owner) values ('homework', t.id('S1') || '/h.jpg', t.id('S1'));
insert into meeting_attendance (meeting_id, user_id) values (t.hm(1), t.id('S1'));
insert into course_messages (course_id, author_id, body) values (t.h(), t.id('M'), 'Hello hidden');

-- AC 1 / AC 11: the column can't be null, and nobody can hide or unhide a course afterwards (out of scope: no edit).
select t.login('M');
select t.throws($$insert into courses (title, created_by, hidden) values ('Null', t.id('M'), null)$$, '23502',
  'AC1 hidden can''t be null');
select t.eq(t.affected($$update courses set hidden = false where id = t.h()$$), 0::bigint, 'out of scope: the owner can''t unhide H');
select t.eq(t.affected($$update courses set hidden = true where id = t.id('A')$$), 0::bigint, 'out of scope: the owner can''t hide A');
select t.login('T');
select t.eq(t.affected($$update courses set hidden = false where id = t.h()$$), 0::bigint, 'out of scope: the teacher can''t unhide H');
reset role;
select t.ok((select hidden from courses where id = t.h()) and not (select hidden from courses where id = t.id('A')),
  'H stays hidden, A stays visible');

-- AC 5: the non-participant student S2, every course-scoped table.
select t.login('S2');
select t.eq((select count(*) from homework where course_id = t.h()), 0::bigint, 'AC5 S2: no homework of H');
select t.eq((select count(*) from meeting_attendance where meeting_id = t.hm(1)), 0::bigint, 'AC5 S2: no attendance of H');
select t.eq((select count(*) from course_messages where course_id = t.h()), 0::bigint, 'AC5 S2: no chat of H');
select t.eq((select count(*) from storage.objects where name = t.id('S1') || '/h.jpg'), 0::bigint, 'AC5 S2: no photo of H');
select t.ok(not exists (select 1 from chat_unread_counts() where course_id = t.h()), 'AC5 S2: no unread count for H');
select t.throws($$insert into course_messages (course_id, author_id, body) values (t.h(), t.id('S2'), 'hi')$$, '42501',
  'AC5 S2 can''t post in H''s chat');
select t.throws($$insert into course_chat_reads (course_id, user_id, last_read_at) values (t.h(), t.id('S2'), now())$$, '42501',
  'AC5 S2 can''t add a read position in H');
select t.throws($$select mark_chat_read(t.h(), (select id from course_messages limit 1))$$, '42501',
  'AC5 S2: mark_chat_read keeps "not in this course chat"');
-- ARU-24 regression: S2 is a listener of visible A and still sees A's content.
select t.eq((select count(*) from course_members where course_id = t.id('A')), 1::bigint, 'regression: S2 sees A''s listeners');

-- AC 5: the non-participant mentor N, the writes the dev tests don't cover.
select t.login('N');
select t.throws($$insert into course_chat_reads (course_id, user_id, last_read_at) values (t.h(), t.id('N'), now())$$, '42501',
  'AC5 N can''t add a read position in H');
select t.throws($$insert into course_members (course_id, user_id, added_by) values (t.h(), t.id('N'), t.id('N'))$$, '42501',
  'AC5 N can''t add themselves as a listener of H');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values (t.free(), t.h(), 'x', t.id('N'))$$,
  'P0002', 'AC5 N assigning homework on H''s free meeting: "Meeting not found."');
select t.throws($$select set_meeting_status(t.free(), 'canceled')$$, 'P0002', 'AC5 N: set_meeting_status "Meeting not found."');
select t.lives($$select remove_listener(t.h(), t.id('M2'))$$, 'AC5 N: remove_listener of a mentor listener, no error');
select t.eq(t.affected($$update homework set mentor_comment = 'x' where course_id = t.h()$$), 0::bigint,
  'AC5 N can''t comment on H''s homework');
-- Visible courses keep today's rules for N (any mentor sees all).
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 0::bigint, 'regression: N reads A''s meetings (none)');
select t.eq((select count(*) from homework where course_id = t.id('A')), 2::bigint, 'regression: N sees A''s homework');
select t.lives($$insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S3'), t.id('N'))$$,
  'regression: N still adds a listener to visible A');
reset role;
select t.ok(exists (select 1 from course_members where course_id = t.h() and user_id = t.id('M2')), 'AC5 M2 is still in H');
select t.eq((select count(*) from course_chat_reads where course_id = t.h()), 0::bigint, 'AC5 no read position was written');

-- The helpers are not callable by signed-out users.
select t.login(null);
select t.throws($$select course_hidden_from_me(t.h())$$, '42501', 'anon can''t call course_hidden_from_me');
select t.throws($$select meeting_hidden_from_me(t.hm(1))$$, '42501', 'anon can''t call meeting_hidden_from_me');
reset role;

-- AC 6: a student listener sees only their own homework in H, as in any course.
select t.login('S1');
select t.eq((select count(*) from homework where course_id = t.h()), 1::bigint, 'AC6 S1 sees only their own homework in H');
select t.lives($$select mark_chat_read(t.h(), (select id from course_messages where course_id = t.h() limit 1))$$,
  'AC6 S1 marks H''s chat read');
select t.eq((select count(*) from course_chat_reads where course_id = t.h() and user_id = t.id('S1')), 1::bigint,
  'AC6 S1''s read position is saved');

-- AC 6: the owner (a mentor who is not a listener) keeps owner rights.
select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values (t.h(), t.id('S3'), t.id('M'))$$,
  'AC6 the owner adds a listener');
select t.lives($$insert into homework_assignments (id, meeting_id, course_id, title, created_by)
  values ('00000000-0000-0000-0000-0000000000f7', t.free(), t.h(), 'Owner HW', t.id('M'))$$, 'AC6 the owner assigns homework');
select t.lives($$insert into course_meetings (id, course_id, starts_at, created_by)
  values ('00000000-0000-0000-0000-0000000000f8', t.h(), now() + interval '2 days', t.id('M'))$$, 'AC6 the owner schedules a meeting');
select t.lives($$select update_meeting('00000000-0000-0000-0000-0000000000f8', now() + interval '3 days', 'Moved', null)$$,
  'AC6 the owner edits it');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-0000000000f8', 'canceled')$$, 'AC6 the owner cancels it');
select t.eq((select count(*) from listener_homework_photos(t.h(), t.id('S1'))), 1::bigint, 'AC6 the owner gets S1''s photos');

-- AC 6: the teacher (not a participant) keeps "any course" rights.
select t.login('T');
select t.eq((select count(*) from course_members where course_id = t.h()), 3::bigint, 'AC6 the teacher sees H''s listeners');
select t.eq((select count(*) from homework_assignments where course_id = t.h()), 6::bigint, 'AC6 the teacher sees H''s assignments');
select t.lives($$select set_meeting_status(t.hm(2), 'completed')$$, 'AC6 the teacher: set_meeting_status retry is a no-op');
select t.eq((select count(*) from listener_homework_photos(t.h(), t.id('S1'))), 1::bigint, 'AC6 the teacher gets S1''s photos');
select t.lives($$update homework set status = 'checked', checked_by = t.id('T'), checked_at = now()
  where id = '00000000-0000-0000-0000-0000000000f3'$$, 'AC6 the teacher checks M2''s homework in H');
select t.lives($$select remove_listener(t.h(), t.id('S3'))$$, 'AC6 the teacher removes a listener');
select t.ok(exists (select 1 from chat_unread_counts() where course_id = t.h()), 'AC6 the teacher has an unread count for H');

-- AC 8: a removed listener loses everything at once, writes included.
select t.lives($$select remove_listener(t.h(), t.id('S1'))$$, 'AC8 the teacher removes S1');
select t.login('S1');
select t.ok(not exists (select 1 from courses where id = t.h()), 'AC8 S1 no longer sees H');
select t.eq((select count(*) from course_messages where course_id = t.h()), 0::bigint, 'AC8 nor its chat');
select t.eq((select count(*) from homework_assignments where course_id = t.h()), 0::bigint, 'AC8 nor its assignments');
select t.eq((select count(*) from course_chat_reads where course_id = t.h()), 0::bigint, 'AC8 nor their old read position');
select t.ok(not exists (select 1 from chat_unread_counts() where course_id = t.h()), 'AC8 nor an unread count');
select t.throws($$select mark_attendance(t.hm(2))$$, 'P0002', 'AC8 mark_attendance: "Meeting not found."');
select t.throws($$insert into course_messages (course_id, author_id, body) values (t.h(), t.id('S1'), 'still here?')$$, '42501',
  'AC8 S1 can''t post any more');
reset role;
select t.eq((select count(*) from homework where course_id = t.h() and student_id = t.id('S1')), 0::bigint,
  'AC8 S1''s homework in H was deleted with the removal (ARU-14)');

-- AC 9: the owner hands H to N; N gains the content, M (not a listener) loses it, including the chat.
select t.login('M');
select t.lives($$select change_course_owner(t.h(), t.id('N'))$$, 'AC9 the owner hands H to N');
select t.eq((select count(*) from course_messages where course_id = t.h()), 0::bigint, 'AC9 the old owner loses the chat');
-- ARU-142: official notes (set_meeting_notes) are retired; meeting notes are written with add_meeting_listener_notes.
select t.throws($$select add_meeting_listener_notes(t.hm(1), 'x')$$, 'P0002', 'AC9 the old owner: add_meeting_listener_notes "Meeting not found."');
select t.login('N');
select t.eq((select count(*) from course_meetings where course_id = t.h()), 7::bigint, 'AC9 the new owner sees H''s meetings');
select t.lives($$select add_meeting_listener_notes(t.hm(1), 'New owner notes')$$, 'AC9 the new owner writes notes (ARU-142)');
reset role;
