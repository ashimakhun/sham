-- ARU-10: course meetings. Rules under test: supabase/migrations/0010_course_meetings.sql.
-- TEST DESIGN users on the shared seed: course A owned by mentor M, course T1 owned by teacher T; N a mentor with
-- no link to A; S1 a student listener of A and T1; S2 a student in nothing; M2 a mentor listener of A.
select t.seed();
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000000d3', 'Teacher course', t.id('T'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  ('00000000-0000-0000-0000-0000000000d3', t.id('S1'), t.id('T'));

-- Meeting ids: F1.. future ones scheduled through the app rules, P* past ones inserted as the admin.
-- f001 F_M (A, by M)   f002 F_T (T1, by T)   f003 F_TA (A, by T)
-- f101 P_A (A, past)   f102 P_T1 (T1, past)  f103 P_A2 (A, past)

-- Data checks: enum, table shape, no end-time column, realtime, no update/delete policy.
select t.eq((select array_agg(e::text order by e) from unnest(enum_range(null::meeting_status)) e),
  array['scheduled', 'completed', 'canceled'], 'data: meeting_status enum values in order');
select t.ok(not exists (select 1 from information_schema.columns where table_name = 'course_meetings'
  and column_name in ('ends_at', 'end_time', 'duration')), 'data: no end time or duration column');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_meetings'),
  'data: course_meetings is in the supabase_realtime publication');
select t.eq((select count(*) from pg_policies where tablename = 'course_meetings' and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0::bigint, 'data: no update or delete policy on course_meetings');
select t.ok((select relrowsecurity from pg_class where relname = 'course_meetings'), 'data: RLS is on');

-- AC 6 / AC 7: the owner (mentor-owned A) and the teacher (own T1, and M's A) schedule; defaults apply.
select t.login('M');
select t.lives($$insert into course_meetings (id, course_id, starts_at, location, created_by) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', 'https://meet.example/a', '00000000-0000-0000-0000-0000000000b1')$$,
  'AC6 mentor owner schedules a meeting on A');
select t.eq((select topic || '/' || status from course_meetings where id = '00000000-0000-0000-0000-00000000f001'),
  'Meeting/scheduled', 'AC7 empty topic defaults to "Meeting", status Scheduled');
reset role; select t.login('T');
select t.lives($$insert into course_meetings (id, course_id, starts_at, topic, created_by) values
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000000d3', now() + interval '2 days', 'Kickoff', '00000000-0000-0000-0000-0000000000a1')$$,
  'AC6 teacher schedules on her own course');
select t.lives($$insert into course_meetings (id, course_id, starts_at, topic, location, created_by) values
  ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-0000000000d1', now() + interval '3 days', 'Review', 'Room 12', '00000000-0000-0000-0000-0000000000a1')$$,
  'AC6 teacher schedules on a mentor-owned course');

-- AC 6: nobody else can schedule; no impersonation; no inserting a finished meeting.
reset role; select t.login('N');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', '00000000-0000-0000-0000-0000000000b2')$$, '42501',
  'AC6 a mentor who does not own the course cannot schedule');
reset role; select t.login('M2');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', '00000000-0000-0000-0000-0000000000b3')$$, '42501',
  'AC6 a mentor listener cannot schedule');
reset role; select t.login('S1');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'AC6 a student listener cannot schedule');
reset role; select t.login(null);
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'roles: anon cannot schedule');
reset role; select t.login('M');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', '00000000-0000-0000-0000-0000000000a1')$$, '42501',
  'AC6 the owner cannot schedule as someone else');
select t.throws($$insert into course_meetings (course_id, starts_at, status, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', 'completed', '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'AC7 a new meeting must be Scheduled');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by, status_changed_by, status_changed_at) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', now())$$, '42501',
  'AC7 a new meeting has no status change yet');
select t.throws($$insert into course_meetings (course_id, starts_at, topic, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', '   ', '00000000-0000-0000-0000-0000000000b1')$$, '23514',
  'AC7 a blank topic is rejected');

-- AC 8: the start must be in the future (database clock).
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() - interval '1 minute', '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'AC8 a meeting in the past is rejected');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now(), '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'AC8 a meeting starting right now is rejected');

-- Retry with the same client id: one row.
select t.throws($$insert into course_meetings (id, course_id, starts_at, location, created_by) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', now() + interval '1 day', 'https://meet.example/a', '00000000-0000-0000-0000-0000000000b1')$$, '23505',
  'retry: the same id cannot schedule twice');
reset role;
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 2::bigint, 'retry: A still has exactly two meetings');

-- Past meetings (the app can't create them; the admin can, for the status tests).
insert into course_meetings (id, course_id, starts_at, topic, created_by, created_at) values
  ('00000000-0000-0000-0000-00000000f101', t.id('A'), now() - interval '1 hour', 'Past A', t.id('M'), now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-0000000000d3', now() - interval '1 hour', 'Past T1', t.id('T'), now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000f103', t.id('A'), now() - interval '2 hours', 'Past A2', t.id('M'), now() - interval '2 days');

-- AC 1 / AC 3: who sees what.
select t.login('T');
select t.eq((select count(*) from course_meetings), 6::bigint, 'AC1 teacher sees all meetings');
reset role; select t.login('N');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 4::bigint, 'AC1 a mentor with no link sees the course''s meetings');
reset role; select t.login('S1');
select t.eq((select count(*) from course_meetings), 6::bigint, 'AC1 a student listener sees meetings of the courses they are in');
reset role; select t.login('S2');
select t.eq((select count(*) from course_meetings), 0::bigint, 'AC3 a student who is not a listener sees none');
reset role; select t.login(null);
select t.eq((select count(*) from course_meetings), 0::bigint, 'roles: anon sees none');

-- No direct update or delete, even for the owner and the teacher.
reset role; select t.login('M');
select t.eq(t.affected($$update course_meetings set status = 'completed' where id = '00000000-0000-0000-0000-00000000f101'$$), 0::bigint,
  'roles: the owner cannot update a meeting directly');
reset role; select t.login('T');
select t.eq(t.affected($$delete from course_meetings$$), 0::bigint, 'roles: the teacher cannot delete meetings');

-- AC 9 / AC 11: the owner marks a past meeting completed; who and when are recorded.
reset role; select t.login('M');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f101', 'completed')$$, 'AC9 owner marks a past meeting completed');
reset role;
select t.eq((select status::text from course_meetings where id = '00000000-0000-0000-0000-00000000f101'), 'completed', 'AC11 status saved');
select t.eq((select status_changed_by from course_meetings where id = '00000000-0000-0000-0000-00000000f101'), t.id('M'), 'AC11 status_changed_by = owner');
select t.ok((select status_changed_at between now() - interval '1 minute' and now() + interval '1 minute' from course_meetings where id = '00000000-0000-0000-0000-00000000f101'),
  'AC11 status_changed_at set');
select t.eq((select topic || '/' || created_by::text from course_meetings where id = '00000000-0000-0000-0000-00000000f101'),
  'Past A/' || t.id('M')::text, 'AC11 nothing else changes');

-- AC 9 / AC 11 (teacher on a mentor-owned course): T cancels a past meeting of A; T's id is recorded.
select t.login('T');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f103', 'canceled')$$, 'AC9 teacher marks a past meeting of A canceled');
reset role;
select t.eq((select status_changed_by from course_meetings where id = '00000000-0000-0000-0000-00000000f103'), t.id('T'), 'AC11 status_changed_by = teacher');
-- Teacher-owned course: T completes her past meeting.
select t.login('T');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f102', 'completed')$$, 'AC9 teacher completes a past meeting of her own course');

-- AC 10: a future meeting can be canceled but not completed.
reset role; select t.login('M');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f001', 'completed')$$, '23514', 'AC10 completed before the start is rejected');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f001', 'canceled')$$, 'AC10 owner cancels a future meeting');
reset role; select t.login('T');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f002', 'completed')$$, '23514', 'AC10 teacher cannot complete a future meeting either');

-- AC 12: completed and canceled are final; the same status again is a safe retry.
reset role; select t.login('M');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f101', 'canceled')$$, '23514', 'AC12 completed cannot become canceled');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f001', 'completed')$$, '23514', 'AC12 canceled cannot become completed');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f101', 'scheduled')$$, '23514', 'AC12 completed cannot be reopened');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f101', 'completed')$$, 'AC12 completed again is a no-op (retry)');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f001', 'canceled')$$, 'AC12 canceled again is a no-op (retry)');
reset role;
select t.eq((select status_changed_by from course_meetings where id = '00000000-0000-0000-0000-00000000f101'), t.id('M'), 'AC12 the retry changed nothing');
select t.login('M');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f003', 'scheduled')$$, '22023', 'status: "scheduled" is not a target status');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000ffff', 'canceled')$$, 'P0002', 'status: unknown meeting');

-- Roles: nobody else changes a status.
reset role; select t.login('N');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f003', 'canceled')$$, '42501', 'AC6 a mentor who does not own A cannot cancel its meeting');
reset role; select t.login('M2');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f003', 'canceled')$$, '42501', 'AC6 a mentor listener cannot cancel');
reset role; select t.login('S1');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f003', 'canceled')$$, '42501', 'AC6 a student cannot cancel');
reset role; select t.login('M');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f002', 'canceled')$$, '42501', 'AC6 M cannot cancel a meeting of the teacher''s course');
reset role; select t.login(null);
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f003', 'canceled')$$, '42501', 'roles: anon cannot execute set_meeting_status');

-- AC 13: the owner of A changes M -> N (as ARU-9 would). N manages A's meetings, including M's; M no longer can;
-- the teacher still can.
reset role;
update courses set created_by = t.id('N') where id = t.id('A');
select t.login('N');
select t.lives($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '5 days', '00000000-0000-0000-0000-0000000000b2')$$,
  'AC13 new owner schedules on A');
reset role; select t.login('M');
select t.throws($$select set_meeting_status('00000000-0000-0000-0000-00000000f003', 'canceled')$$, '42501', 'AC13 former owner cannot cancel');
select t.throws($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', now() + interval '5 days', '00000000-0000-0000-0000-0000000000b1')$$, '42501',
  'AC13 former owner cannot schedule');
reset role; select t.login('N');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f003', 'canceled')$$, 'AC13 new owner cancels a meeting scheduled by someone else');
-- Teacher course T1 handed to M: M can manage it, T still can.
reset role;
update courses set created_by = t.id('M') where id = '00000000-0000-0000-0000-0000000000d3';
select t.login('M');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f002', 'canceled')$$, 'AC13 new owner of the teacher''s former course cancels its meeting');
reset role; select t.login('T');
select t.lives($$insert into course_meetings (course_id, starts_at, created_by) values
  ('00000000-0000-0000-0000-0000000000d3', now() + interval '5 days', '00000000-0000-0000-0000-0000000000a1')$$,
  'AC13 the teacher still schedules on a course she no longer owns');

-- Edge: a removed listener stops seeing meetings; deleting a course removes its meetings.
reset role; select t.login('N');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, 'edge: S1 removed from A');
reset role; select t.login('S1');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 0::bigint, 'edge: removed listener sees none of A''s meetings');
select t.ok((select count(*) from course_meetings where course_id = '00000000-0000-0000-0000-0000000000d3') > 0, 'edge: still sees T1''s meetings');
reset role;
delete from courses where id = t.id('A');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 0::bigint, 'data: deleting a course deletes its meetings');
