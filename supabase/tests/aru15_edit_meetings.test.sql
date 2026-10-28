-- ARU-15: edit and reschedule a Scheduled meeting. Rules under test: supabase/migrations/0011_edit_meetings.sql.
-- Course A owned by mentor M, course T1 (d3) owned by teacher T; N a mentor with no link; S1 a student listener;
-- M2 a mentor listener of A. Meetings (inserted as the admin): F future, P past unmarked, C completed, X canceled
-- on A; G future on T1.
select t.seed();
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000000d3', 'Teacher course', t.id('T'));
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  ('00000000-0000-0000-0000-0000000000d3', t.id('S1'), t.id('T'));
insert into course_meetings (id, course_id, starts_at, topic, location, status, created_by) values
  ('00000000-0000-0000-0000-00000000f201', t.id('A'), now() + interval '1 day', 'Future', 'Room 1', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f202', t.id('A'), now() - interval '1 hour', 'Past', null, 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f203', t.id('A'), now() - interval '2 days', 'Done', null, 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000000f204', t.id('A'), now() + interval '2 days', 'Dropped', null, 'canceled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f205', '00000000-0000-0000-0000-0000000000d3', now() + interval '3 days', 'Teacher', null, 'scheduled', t.id('T'));

-- Data: the new column, still no update policy, function locked down.
select t.ok(exists (select 1 from information_schema.columns where table_name = 'course_meetings' and column_name = 'rescheduled_at'
  and data_type = 'timestamp with time zone' and is_nullable = 'YES'), 'data: rescheduled_at timestamptz, nullable');
select t.eq((select count(*) from pg_policies where tablename = 'course_meetings' and cmd in ('UPDATE', 'ALL')), 0::bigint,
  'data: still no update policy on course_meetings');
select t.eq((select count(*) from course_meetings where rescheduled_at is not null), 0::bigint, 'data: existing meetings are not rescheduled');

-- A new meeting can't claim to be rescheduled.
select t.login('M');
select t.lives($$insert into course_meetings (id, course_id, starts_at, created_by, rescheduled_at) values
  ('00000000-0000-0000-0000-00000000f206', '00000000-0000-0000-0000-0000000000d1', now() + interval '4 days', '00000000-0000-0000-0000-0000000000b1', now())$$,
  'data: insert with rescheduled_at goes through');
reset role;
select t.ok((select rescheduled_at is null from course_meetings where id = '00000000-0000-0000-0000-00000000f206'), 'data: ...but rescheduled_at is cleared');

-- AC 2 / AC 4: the owner edits topic and link of F (same time): id and status kept, no Rescheduled.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f201',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), 'Exam prep', 'https://meet.example/z')$$,
  'AC2 owner edits topic and link');
reset role;
select t.eq((select topic || '|' || location || '|' || status from course_meetings where id = '00000000-0000-0000-0000-00000000f201'),
  'Exam prep|https://meet.example/z|scheduled', 'AC2 saved; status kept');
select t.ok((select rescheduled_at is null from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), 'AC5 topic/link only: no Rescheduled');

-- AC 4: blank topic → "Meeting"; blank location → removed; surrounding spaces trimmed.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f201',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), '   ', '  ')$$, 'AC4 clear topic and link');
reset role;
select t.eq((select topic || '|' || coalesce(location, '<null>') from course_meetings where id = '00000000-0000-0000-0000-00000000f201'),
  'Meeting|<null>', 'AC4 topic "Meeting", location removed');
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f201',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), null, null)$$, 'AC4 null topic and location are accepted');
reset role;
select t.eq((select topic from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), 'Meeting', 'AC4 null topic → "Meeting"');

-- AC 3 / AC 5: moving F to another future time sets rescheduled_at.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f201', now() + interval '5 days', 'Moved', null)$$,
  'AC3 owner moves F to a new future time');
reset role;
select t.ok((select starts_at > now() + interval '4 days' and rescheduled_at is not null from course_meetings where id = '00000000-0000-0000-0000-00000000f201'),
  'AC5 rescheduled_at set on a time change');

-- AC 3: a changed time in the past (or now) is rejected; nothing changes.
select t.login('M');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f201', now() - interval '1 minute', 'Back', null)$$, '23514',
  'AC3 moving to the past is rejected');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f201', now(), 'Now', null)$$, '23514',
  'AC3 moving to right now is rejected');
reset role;
select t.eq((select topic from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), 'Moved', 'AC3 the rejected edit changed nothing');

-- AC 3: a past, unmarked meeting: topic-only edit works (same time), no Rescheduled; moving it to the future works.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f202',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f202'), 'Past fixed', 'Room 9')$$,
  'AC3 topic-only edit of a past unmarked meeting succeeds');
reset role;
select t.ok((select topic = 'Past fixed' and rescheduled_at is null and starts_at < now() from course_meetings where id = '00000000-0000-0000-0000-00000000f202'),
  'AC3 saved, time unchanged, not rescheduled');
select t.login('M');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f202', now() - interval '3 hours', 'Past fixed', 'Room 9')$$, '23514',
  'AC3 moving a past meeting to another past time is rejected');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f202', now() + interval '6 hours', 'Past fixed', 'Room 9')$$,
  'AC3 moving a past meeting to the future succeeds');
reset role;
select t.ok((select status = 'scheduled' and rescheduled_at is not null from course_meetings where id = '00000000-0000-0000-0000-00000000f202'),
  'AC3 it stays Scheduled and is marked Rescheduled');

-- Retry: the same values again change nothing (rescheduled_at stays as it was).
create temp table snap as select * from course_meetings where id = '00000000-0000-0000-0000-00000000f201';
grant select on snap to authenticated;
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f201',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), 'Moved', null)$$, 'retry: same values again');
reset role;
select t.ok((select c.rescheduled_at = s.rescheduled_at and c.starts_at = s.starts_at and c.topic = s.topic
  from course_meetings c, snap s where c.id = s.id), 'retry: nothing changed');

-- AC 6: completed and canceled meetings can't be edited, not even by the teacher.
select t.login('M');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f203', now() + interval '1 day', 'Reopen', null)$$, '23514',
  'AC6 owner cannot edit a completed meeting');
reset role; select t.login('T');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f204',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f204'), 'Revive', null)$$, '23514',
  'AC6 teacher cannot edit a canceled meeting');

-- AC 1: the teacher edits on her own course and on a mentor-owned course.
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f205', now() + interval '7 days', 'Teacher moved', null)$$,
  'AC1 teacher reschedules on her own course');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f201', now() + interval '8 days', 'Teacher on A', null)$$,
  'AC1 teacher reschedules on a mentor-owned course');

-- AC 1: nobody else may edit.
reset role; select t.login('N');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f201', now() + interval '9 days', 'N', null)$$, '42501',
  'AC1 a mentor who does not own the course cannot edit');
reset role; select t.login('M2');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f201', now() + interval '9 days', 'M2', null)$$, '42501',
  'AC1 a mentor listener cannot edit');
reset role; select t.login('S1');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f201', now() + interval '9 days', 'S1', null)$$, '42501',
  'AC1 a student listener cannot edit');
reset role; select t.login('M');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f205', now() + interval '9 days', 'M', null)$$, '42501',
  'AC1 M cannot edit a meeting of the teacher''s course');
select t.eq(t.affected($$update course_meetings set topic = 'direct' where id = '00000000-0000-0000-0000-00000000f201'$$), 0::bigint,
  'AC1 no direct update, even for the owner');
reset role; select t.login(null);
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f201', now() + interval '9 days', 'anon', null)$$, '42501',
  'roles: anon cannot execute update_meeting');
reset role; select t.login('M');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000ffff', now() + interval '9 days', 'x', null)$$, 'P0002',
  'edit: unknown meeting');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f201', null, 'x', null)$$, '22023',
  'edit: a missing start time is rejected');

-- Only starts_at, topic, location (and rescheduled_at) change.
reset role;
select t.ok((select status = 'scheduled' and created_by = t.id('M') and course_id = t.id('A') and status_changed_by is null
  from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), 'edit: nothing else changed');

-- Owner change M → N (as ARU-9 would): N edits M's meeting, M can't, the teacher still can.
update courses set created_by = t.id('N') where id = t.id('A');
select t.login('N');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f201',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), 'N edits', null)$$, 'ARU-9 new owner edits');
reset role; select t.login('M');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f201',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), 'M edits', null)$$, '42501', 'ARU-9 former owner cannot edit');
reset role; select t.login('T');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f201',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f201'), 'T edits', null)$$, 'ARU-9 teacher still edits');
