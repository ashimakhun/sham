-- ARU-36: a signed-out caller assigning homework gets the permission error (42501) whatever the meeting's state, so
-- nothing about the meeting is revealed. Fix under test: supabase/migrations/0015_assign_homework_anon_error.sql.
select t.seed();
insert into course_meetings (id, course_id, starts_at, topic, status, created_by) values
  ('00000000-0000-0000-0000-00000000f361', t.id('A'), now() - interval '2 days', 'Assigned', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000000f362', t.id('A'), now() + interval '1 day', 'Scheduled', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f363', t.id('A'), now() - interval '1 day', 'Free', 'completed', t.id('M'));
select t.login('M');
insert into homework_assignments (id, meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000a361', '00000000-0000-0000-0000-00000000f361', t.id('A'), 'Existing', t.id('M'));
reset role;

select t.login(null);
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f361', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000b1')$$,
  '42501', 'anon on a meeting that already has homework → 42501');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f362', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000b1')$$,
  '42501', 'anon on a scheduled meeting → 42501');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-0000000fffff', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000b1')$$,
  '42501', 'anon on an unknown meeting → 42501');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f363', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000b1')$$,
  '42501', 'anon on a free completed meeting → 42501');
reset role;
select t.eq((select count(*) from homework_assignments), 1::bigint, 'nothing saved');

-- Signed-in callers are unchanged: the owner still assigns, a student still gets 42501.
select t.login('S1');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f363', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000c1')$$,
  '42501', 'student → 42501 (unchanged)');
select t.login('M');
select t.lives($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f363', '00000000-0000-0000-0000-0000000000d1', 'Owner', '00000000-0000-0000-0000-0000000000b1')$$,
  'the owner still assigns');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000f362', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000b1')$$,
  '23514', 'the owner still gets the readable status error');
reset role;
