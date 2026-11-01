-- QA ARU-45: gaps in aru45_attendance_from_start.test.sql: the exact start boundary, undo after completion, a removed
-- listener, a reschedule into the future and back, hidden courses (0019) and the grants after the replace.
-- Course A: owner M, listeners S1 and M2. Hidden course H: owner M, listener S3; N and S2 are in neither.
select t.seed();
insert into courses (id, title, created_by, hidden) values ('00000000-0000-0000-0000-0000000045a1', 'Secret', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('M2'), t.id('M')),
  ('00000000-0000-0000-0000-0000000045a1', t.id('S3'), t.id('M'));

create function t.q(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000045b' || n::text)::uuid
$$;
grant execute on function t.q(int) to anon, authenticated;

-- Q1 starts exactly now (statement time); Q2 started 5 min ago; Q3 started 5 min ago in hidden H.
set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.q(2), t.id('A'), now() - interval '5 minutes', 'scheduled', t.id('M')),
  (t.q(3), '00000000-0000-0000-0000-0000000045a1', now() - interval '5 minutes', 'scheduled', t.id('M'));
set session_replication_role = origin;

-- AC 3: the database clock decides, and the start itself counts as started (starts_at <= now()).
do $$
begin
  set session_replication_role = replica;
  insert into course_meetings (id, course_id, starts_at, status, created_by)
    values (t.q(1), t.id('A'), now(), 'scheduled', t.id('M'));
  set session_replication_role = origin;
  perform t.login('S1');
  perform mark_attendance(t.q(1));
  reset role;
  perform t.ok(exists (select 1 from meeting_attendance where meeting_id = t.q(1) and user_id = t.id('S1')),
    'AC3 a meeting starting at this very moment is open');
end $$;

-- AC 4 / AC 6: mark a started meeting, the owner completes it, then the listener can still undo.
select t.login('S1');
select t.lives($$select mark_attendance(t.q(2))$$, 'AC1 S1 marks started Q2');
select t.login('M');
select t.lives($$select set_meeting_status(t.q(2), 'completed')$$, 'AC4 the owner completes Q2');
select t.login('S1');
select t.eq((select count(*) from meeting_attendance where meeting_id = t.q(2)), 1::bigint, 'AC4 the mark is kept');
select t.lives($$select unmark_attendance(t.q(2))$$, 'AC6 S1 undoes on the now Completed meeting');
select t.lives($$select unmark_attendance(t.q(2))$$, 'AC6 undoing again is a no-op');
select t.lives($$select mark_attendance(t.q(2))$$, 'AC4 and marks again');

-- Removed listener: can't undo, and the mark stays.
select t.login('M');
select t.lives($$select remove_listener(t.id('A'), t.id('M2'))$$, 'setup: M2 marks first, then is removed');
reset role;
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('M2'), t.id('M'));
select t.login('M2');
select t.lives($$select mark_attendance(t.q(2))$$, 'M2 marks Q2');
select t.login('M');
select t.lives($$select remove_listener(t.id('A'), t.id('M2'))$$, 'the owner removes M2');
select t.login('M2');
select t.throws($$select unmark_attendance(t.q(2))$$, '42501', 'edge: a removed listener can''t undo');
select t.throws($$select mark_attendance(t.q(2))$$, '42501', 'edge: nor mark');
reset role;
select t.ok(exists (select 1 from meeting_attendance where meeting_id = t.q(2) and user_id = t.id('M2')), 'edge: the mark stays stored');

-- Reschedule a started meeting into the future and back (the owner edits a Scheduled meeting).
select t.login('S1');
select t.lives($$select mark_attendance(t.q(1))$$, 'S1''s mark on Q1 (already there, no-op)');
select t.login('M');
select t.lives($$select update_meeting(t.q(1), now() + interval '1 day', 'Moved', null)$$, 'the owner moves Q1 to tomorrow');
select t.login('S1');
select t.throws($$select mark_attendance(t.q(1))$$, '23514', 'reschedule: mark is closed');
select t.throws($$select unmark_attendance(t.q(1))$$, '23514', 'reschedule: undo is closed');
reset role;
select t.ok(exists (select 1 from meeting_attendance where meeting_id = t.q(1) and user_id = t.id('S1')), 'reschedule: the mark is kept');
update course_meetings set starts_at = now() - interval '1 minute' where id = t.q(1);
select t.login('S1');
select t.lives($$select unmark_attendance(t.q(1))$$, 'reschedule: open again once the (new) start has passed');

-- Hidden course H: the participant marks; a non-participant still gets "Meeting not found." first (0019 kept).
select t.login('S3');
select t.lives($$select mark_attendance(t.q(3))$$, 'ARU-40: H''s listener marks a started meeting of H');
select t.login('N');
select t.throws($$select mark_attendance(t.q(3))$$, 'P0002', 'ARU-40: a non-participant mentor gets "Meeting not found."');
select t.throws($$select unmark_attendance(t.q(3))$$, 'P0002', 'ARU-40: on undo too');
select t.login('S2');
select t.throws($$select mark_attendance(t.q(3))$$, 'P0002', 'ARU-40: a non-participant student too');

-- Grants after "create or replace": signed-out callers still can't call either function.
select t.login(null);
select t.throws($$select mark_attendance(t.q(2))$$, '42501', 'anon can''t mark');
select t.throws($$select unmark_attendance(t.q(2))$$, '42501', 'anon can''t undo');
reset role;
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc where proname = 'mark_attendance')
  and (select prosecdef and 'search_path=public' = any(proconfig) from pg_proc where proname = 'unmark_attendance'),
  'both stay security definer with search_path = public');
