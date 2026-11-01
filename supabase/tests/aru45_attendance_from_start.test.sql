-- ARU-45: listeners mark attendance as soon as a meeting has started. Rules under test:
-- supabase/migrations/0022_attendance_from_start.sql. Course A: owner M, listeners S1 (student) and M2 (mentor);
-- S2 (student) and N (mentor) are not listeners. Meetings of A (inserted as the admin):
--   P upcoming (Scheduled, in 1 h), R started (Scheduled, 10 min ago), D Completed, X Canceled after start with S1's
--   mark from before the cancel, J just started (Scheduled, 1 min ago) and K about to start (Scheduled, in 1 min).
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('M2'), t.id('M'));

create function t.mt(name text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000045' || case name when 'P' then '0001' when 'R' then '0002' when 'D' then '0003'
    when 'X' then '0004' when 'J' then '0005' when 'K' then '0006' end)::uuid
$$;
grant execute on function t.mt(text) to anon, authenticated;
-- Error message of a call (or 'ok').
create function t.msg(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function t.msg(text) to anon, authenticated;

set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.mt('P'), t.id('A'), now() + interval '1 hour',    'scheduled', t.id('M')),
  (t.mt('R'), t.id('A'), now() - interval '10 minutes', 'scheduled', t.id('M')),
  (t.mt('D'), t.id('A'), now() - interval '1 day',     'completed', t.id('M')),
  (t.mt('X'), t.id('A'), now() - interval '1 day',     'canceled',  t.id('M')),
  (t.mt('J'), t.id('A'), now() - interval '1 minute',  'scheduled', t.id('M')),
  (t.mt('K'), t.id('A'), now() + interval '1 minute',  'scheduled', t.id('M'));
insert into meeting_attendance (meeting_id, user_id) values (t.mt('X'), t.id('S1'));
set session_replication_role = origin;

-- AC 1: a started Scheduled meeting is open; a repeat is a no-op.
select t.login('S1');
select t.lives($$select mark_attendance(t.mt('R'))$$, 'AC1 a student listener marks a started Scheduled meeting');
select t.lives($$select mark_attendance(t.mt('R'))$$, 'AC1 marking again is a no-op');
select t.login('M2');
select t.lives($$select mark_attendance(t.mt('R'))$$, 'AC1 a mentor listener marks it too');
reset role;
select t.eq((select count(*) from meeting_attendance where meeting_id = t.mt('R')), 2::bigint, 'AC1 two marks, no duplicates');

-- AC 3: not before the start, by the database clock.
select t.login('S1');
select t.eq(t.msg($$select mark_attendance(t.mt('P'))$$), '23514 Attendance can be marked once the meeting has started.',
  'AC3 an upcoming meeting is rejected with the new message');
select t.eq(t.msg($$select mark_attendance(t.mt('K'))$$), '23514 Attendance can be marked once the meeting has started.',
  'AC3 one minute before the start: rejected');
select t.eq(t.msg($$select mark_attendance(t.mt('J'))$$), 'ok', 'AC3 one minute after the start: accepted');
select t.eq(t.msg($$select unmark_attendance(t.mt('P'))$$), '23514 Attendance can be marked once the meeting has started.',
  'AC3 undo is closed before the start too');

-- AC 4: Completed meetings work as before, and a mark made before completion stays.
select t.lives($$select mark_attendance(t.mt('D'))$$, 'AC4 a Completed meeting can be marked');
select t.lives($$select unmark_attendance(t.mt('D'))$$, 'AC4 and undone');
select t.login('M');
select t.lives($$select set_meeting_status(t.mt('R'), 'completed')$$, 'AC4 the owner completes R after the marks');
reset role;
select t.eq((select count(*) from meeting_attendance where meeting_id = t.mt('R')), 2::bigint, 'AC4 marks made before completion are kept');

-- AC 5: Canceled meetings can't be changed; marks from before the cancel stay.
select t.login('S1');
select t.eq(t.msg($$select mark_attendance(t.mt('X'))$$), '23514 Attendance can''t be changed for a canceled meeting.',
  'AC5 marking a canceled meeting is rejected');
select t.eq(t.msg($$select unmark_attendance(t.mt('X'))$$), '23514 Attendance can''t be changed for a canceled meeting.',
  'AC5 undoing on a canceled meeting is rejected');
reset role;
select t.ok(exists (select 1 from meeting_attendance where meeting_id = t.mt('X') and user_id = t.id('S1')),
  'AC5 the mark from before the cancel is still stored');
-- Cancel a started meeting that has marks: they stay.
select t.login('M');
select t.lives($$select set_meeting_status(t.mt('J'), 'canceled')$$, 'AC5 the owner cancels J after S1 marked it');
reset role;
select t.ok(exists (select 1 from meeting_attendance where meeting_id = t.mt('J') and user_id = t.id('S1')),
  'AC5 marks stay after the cancel');

-- AC 6: undo while open.
select t.login('M2');
select t.lives($$select unmark_attendance(t.mt('R'))$$, 'AC6 a listener undoes their mark');
reset role;
select t.ok(not exists (select 1 from meeting_attendance where meeting_id = t.mt('R') and user_id = t.id('M2')), 'AC6 the mark is gone');
select t.ok(exists (select 1 from meeting_attendance where meeting_id = t.mt('R') and user_id = t.id('S1')), 'AC6 others'' marks stay');

-- Who is unchanged (ARU-33): non-listeners are refused before the time checks.
select t.login('S2');
select t.eq(t.msg($$select mark_attendance(t.mt('P'))$$), '42501 Only listeners of this course can mark attendance.',
  'who: a non-listener student is refused (listener check first)');
select t.login('N');
select t.eq(t.msg($$select mark_attendance(t.mt('D'))$$), '42501 Only listeners of this course can mark attendance.',
  'who: a non-listener mentor is refused');
select t.login('M');
select t.eq(t.msg($$select mark_attendance(t.mt('D'))$$), '42501 Only listeners of this course can mark attendance.',
  'who: the owner is refused');

-- Edge case: a started meeting rescheduled into the future closes attendance again; its marks stay.
reset role;
set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, status, created_by)
  values ('00000000-0000-0000-0000-000000450007', t.id('A'), now() - interval '5 minutes', 'scheduled', t.id('M'));
set session_replication_role = origin;
select t.login('S1');
select t.lives($$select mark_attendance('00000000-0000-0000-0000-000000450007')$$, 'reschedule: S1 marks a started meeting');
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-000000450007', now() + interval '1 day', 'Moved', null)$$,
  'reschedule: the owner moves it to tomorrow');
select t.login('S1');
select t.eq(t.msg($$select unmark_attendance('00000000-0000-0000-0000-000000450007')$$),
  '23514 Attendance can be marked once the meeting has started.', 'reschedule: undo is closed until the new start');
reset role;
select t.ok(exists (select 1 from meeting_attendance where meeting_id = '00000000-0000-0000-0000-000000450007'),
  'reschedule: the mark stays stored');

-- Data: the functions keep their privileges.
select t.ok(not has_function_privilege('anon', 'mark_attendance(uuid)', 'execute'), 'data: anon cannot mark');
select t.ok(not has_function_privilege('anon', 'unmark_attendance(uuid)', 'execute'), 'data: anon cannot undo');
