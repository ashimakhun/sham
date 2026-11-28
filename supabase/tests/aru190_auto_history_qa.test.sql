-- QA ARU-190: the auto-move to MEETING HISTORY is display only. Checks the data it relies on and that nothing is
-- saved: set_meeting_status() stamps status_changed_at on Completed; a Completed meeting with no homework more than a
-- day old (homework_checked_at still null) can still get homework from the owner and the teacher (AC 5); the
-- listeners who see the meeting also see status_changed_at and the assignment (AC 7); a listener can't assign; a
-- canceled meeting still can't get homework. Course A owned by mentor M; S1 a student listener, M2 a mentor listener.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));
-- Past meetings can only be created by the admin (the insert policy needs a future start).
insert into course_meetings (id, course_id, starts_at, topic, created_by) values
  ('00000000-0000-0000-0000-0000000190a1', t.id('A'), now() - interval '3 days', 'Old', t.id('M')),
  ('00000000-0000-0000-0000-0000000190a2', t.id('A'), now() - interval '3 days', 'Old 2', t.id('M')),
  ('00000000-0000-0000-0000-0000000190a3', t.id('A'), now() - interval '3 days', 'Canceled', t.id('M'));

-- The owner marks them Completed / Canceled through the app's function: status_changed_at is stamped.
select t.login('M');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-0000000190a1', 'completed')$$, 'owner completes a1');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-0000000190a2', 'completed')$$, 'owner completes a2');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-0000000190a3', 'canceled')$$, 'owner cancels a3');
reset role;
select t.ok((select status_changed_at is not null from course_meetings where id = '00000000-0000-0000-0000-0000000190a1'),
  'Completed stamps status_changed_at (the clock the 24 h counts from)');

-- Two days pass with no homework.
update course_meetings set status_changed_at = now() - interval '2 days'
  where id in ('00000000-0000-0000-0000-0000000190a1', '00000000-0000-0000-0000-0000000190a2');

-- AC 7: every listener reads the same status, status_changed_at and (no) homework, so the grouping is the same.
select t.login('S1');
select t.eq((select count(*) from course_meetings where id = '00000000-0000-0000-0000-0000000190a1'
  and status = 'completed' and status_changed_at < now() - interval '1 day' and homework_checked_at is null), 1::bigint,
  'AC7 student listener sees the meeting with its status_changed_at');
reset role;
select t.login('M2');
select t.eq((select count(*) from course_meetings where id = '00000000-0000-0000-0000-0000000190a1'
  and status_changed_at < now() - interval '1 day'), 1::bigint, 'AC7 mentor listener sees status_changed_at too');
reset role;

-- AC 5 denied: a listener can't set homework on it.
select t.login('S1');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-0000000190a1', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000c1')$$,
  '42501', 'AC5 denied: a student listener can''t assign homework');
reset role;
select t.login('M2');
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-0000000190a1', '00000000-0000-0000-0000-0000000000d1', 'x', '00000000-0000-0000-0000-0000000000b3')$$,
  '42501', 'AC5 denied: a mentor listener can''t assign homework');
reset role;

-- AC 5: the owner and the teacher can still set homework a day later (the meeting then returns to Awaiting check).
select t.login('M');
select t.lives($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-0000000190a1', '00000000-0000-0000-0000-0000000000d1', 'Late', '00000000-0000-0000-0000-0000000000b1')$$,
  'AC5 owner sets homework 2 days after Completed');
reset role;
select t.login('T');
select t.lives($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-0000000190a2', '00000000-0000-0000-0000-0000000000d1', 'Late T', '00000000-0000-0000-0000-0000000000a1')$$,
  'AC5 teacher sets homework 2 days after Completed');
-- Canceled meetings: still refused (0014, unchanged).
select t.throws($$insert into homework_assignments (meeting_id, course_id, title, created_by) values
  ('00000000-0000-0000-0000-0000000190a3', '00000000-0000-0000-0000-0000000000d1', 'No', '00000000-0000-0000-0000-0000000000a1')$$,
  '23514', 'AC9 a canceled meeting still can''t get homework (trigger: completed meetings only)');
reset role;

-- AC 6 / out of scope: nothing marks these meetings checked.
select t.eq((select count(*) from course_meetings where id in ('00000000-0000-0000-0000-0000000190a1',
  '00000000-0000-0000-0000-0000000190a2') and homework_checked_at is null and homework_checked_by is null), 2::bigint,
  'AC6 homework_checked_at / _by stay null');
