-- ARU-10 QA additions to aru10_course_meetings.test.sql: the third test-note run (teacher on a mentor-owned
-- course) for completing, a teacher-owned course seen and managed by others, insert edge cases, and a
-- concurrent-looking double status change. Rules under test: supabase/migrations/0010_course_meetings.sql.
-- Course A owned by mentor M; T1 owned by teacher T with mentor N as a listener; S1 listener of A; S2 in nothing.
select t.seed();
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000000d3', 'Teacher course', t.id('T'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  ('00000000-0000-0000-0000-0000000000d3', t.id('N'), t.id('T'));
-- Past meetings can only be created by the admin (the insert policy needs a future start).
insert into course_meetings (id, course_id, starts_at, topic, created_by) values
  ('00000000-0000-0000-0000-00000000f201', t.id('A'), now() - interval '2 hours', 'A past', t.id('M')),
  ('00000000-0000-0000-0000-00000000f202', '00000000-0000-0000-0000-0000000000d3', now() - interval '1 hour', 'T1 past', t.id('T')),
  ('00000000-0000-0000-0000-00000000f203', '00000000-0000-0000-0000-0000000000d3', now() + interval '1 day', 'T1 future', t.id('T'));

-- Test note run 3 (teacher on a mentor-owned course): the teacher completes a past meeting of A.
select t.login('T');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f201', 'completed')$$,
  'AC9 run 3: the teacher completes a past meeting of mentor-owned A');
reset role;
select t.eq((select status::text || '/' || (status_changed_by = t.id('T'))::text from course_meetings where id = '00000000-0000-0000-0000-00000000f201'),
  'completed/true', 'AC11 run 3: status and status_changed_by = teacher saved');

-- Teacher-owned course T1: a mentor who is a listener sees it but cannot manage it; another mentor neither.
select t.login('N');
select t.eq((select count(*) from course_meetings where course_id = '00000000-0000-0000-0000-0000000000d3'), 2::bigint,
  'AC1 a mentor listener of the teacher''s course sees its meetings');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f202', 'completed')$$, '42501',
  'AC6 a mentor listener cannot complete a meeting of the teacher''s course');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values ('00000000-0000-0000-0000-0000000000d3', now() + interval '1 day', '00000000-0000-0000-0000-0000000000b2')$$, '42501',
  'AC6 a mentor listener cannot schedule on the teacher''s course');
reset role; select t.login('M');
select t.eq((select count(*) from course_meetings where course_id = '00000000-0000-0000-0000-0000000000d3'), 2::bigint,
  'AC1 a mentor with no link sees the teacher''s course meetings');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f203', 'canceled')$$, '42501',
  'AC6 a mentor who owns another course cannot cancel a meeting of the teacher''s course');
reset role; select t.login('S1');
select t.eq((select count(*) from course_meetings where course_id = '00000000-0000-0000-0000-0000000000d3'), 0::bigint,
  'AC3 a student listener of A sees none of T1''s meetings');
reset role; select t.login('S2');
select t.eq((select count(*) from course_meetings), 0::bigint, 'AC3 a student in no course sees no meetings');

-- Insert edge cases.
reset role; select t.login('T');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values ('00000000-0000-0000-0000-00000000ffff', now() + interval '1 day', '00000000-0000-0000-0000-0000000000a1')$$, '23503',
  'a meeting for a course that does not exist is rejected');
select t.throws($$insert into course_meetings (course_id, starts_at, status, status_changed_by, status_changed_at, created_by) values ('00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', 'canceled', '00000000-0000-0000-0000-0000000000a1', now(), '00000000-0000-0000-0000-0000000000a1')$$, '42501',
  'AC7 a new meeting cannot be created already canceled');
select t.lives($$insert into course_meetings (id, course_id, starts_at, topic, location, created_by) values ('00000000-0000-0000-0000-00000000f204', '00000000-0000-0000-0000-0000000000d1', now() + interval '5 minutes', '  Spaces kept  ', null, '00000000-0000-0000-0000-0000000000a1')$$,
  'AC7 a meeting a few minutes ahead with no location is accepted');
select t.eq(t.affected($$update course_meetings set starts_at = now() + interval '9 days' where id = '00000000-0000-0000-0000-00000000f204'$$), 0::bigint,
  'no update policy: the teacher cannot move a meeting directly (rescheduling is ARU-15)');

-- A second, different status change after the first is rejected (two people tapping at once: one wins).
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f202', 'canceled')$$,
  'AC12 the first change (canceled) wins');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f202', 'completed')$$, '23514',
  'AC12 the second, different change is rejected, not applied');
reset role;
select t.eq((select status::text from course_meetings where id = '00000000-0000-0000-0000-00000000f202'), 'canceled',
  'AC12 the meeting stays canceled');

-- set_meeting_status only touches the status columns.
select t.eq((select topic || '|' || starts_at::text from course_meetings where id = '00000000-0000-0000-0000-00000000f202'),
  (select 'T1 past|' || starts_at::text from course_meetings where id = '00000000-0000-0000-0000-00000000f202'),
  'AC11 the topic and start are unchanged by a status change');
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc where proname = 'set_meeting_status'),
  'data: set_meeting_status is security definer with search_path = public');
