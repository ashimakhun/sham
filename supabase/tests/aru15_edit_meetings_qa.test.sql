-- ARU-15 QA additions to aru15_edit_meetings.test.sql: the "unchanged time" round trip as the app sends it
-- (the start string PostgREST returned), time zones, two edits in a row, and status changes after an edit.
-- Rules under test: supabase/migrations/0011_edit_meetings.sql. Course A owned by mentor M.
select t.seed();
-- A past, unmarked meeting with sub-second precision (as now() produces), and a future one.
insert into course_meetings (id, course_id, starts_at, topic, created_by) values
  ('00000000-0000-0000-0000-00000000f301', t.id('A'), now() - interval '90 minutes 0.123456 seconds', 'Past', t.id('M')),
  ('00000000-0000-0000-0000-00000000f302', t.id('A'), timestamptz '2031-03-01 10:00:00+00', 'Future', t.id('M'));

-- AC3 / analysis note 1: the app sends back the exact start string it loaded (PostgREST's JSON text, here
-- to_json(starts_at) #>> '{}'), so a topic-only edit of a past meeting is not a reschedule, even with microseconds.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f301',
    (select to_json(starts_at) #>> '{}' from course_meetings where id = '00000000-0000-0000-0000-00000000f301')::timestamptz,
    'Past, renamed', null)$$,
  'AC3 topic-only edit with the start string as loaded (microseconds) succeeds');
reset role;
select t.ok((select topic = 'Past, renamed' and rescheduled_at is null from course_meetings where id = '00000000-0000-0000-0000-00000000f301'),
  'AC5 ...and is not marked Rescheduled');

-- The same instant in another time zone or format is not a change.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f302', '2031-03-01T15:00:00+05:00', 'Future', null)$$,
  'AC3 the same instant written with another offset is accepted');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f302', '2031-03-01T10:00:00.000Z', 'Future', null)$$,
  'AC3 ...and as an ISO string with milliseconds and Z (what the app sends)');
reset role;
select t.ok((select rescheduled_at is null from course_meetings where id = '00000000-0000-0000-0000-00000000f302'),
  'AC5 neither counts as a reschedule');

-- Two edits in a row (two devices): the last one wins; the note stays from the first move.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f302', '2031-03-02T10:00:00Z', 'Device 1', 'Room 1')$$,
  'edge: first device saves a new time');
reset role; select t.login('T');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f302', '2031-03-02T10:00:00Z', 'Device 2', 'https://meet.example/2')$$,
  'edge: the teacher saves afterwards with the same time and other text');
reset role;
select t.eq((select topic || '|' || location || '|' || (starts_at = timestamptz '2031-03-02 10:00:00+00')::text || '|' || (rescheduled_at is not null)::text
  from course_meetings where id = '00000000-0000-0000-0000-00000000f302'),
  'Device 2|https://meet.example/2|true|true', 'edge: the last save wins and the meeting stays Rescheduled');

-- After a reschedule, the status actions from ARU-10 still work and the meeting is then locked.
select t.login('M');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f302', 'canceled')$$,
  'ARU-10 regression: a rescheduled meeting can be canceled');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f302', '2031-03-05T10:00:00Z', 'Back', null)$$, '23514',
  'AC6 ...and can no longer be edited');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f301', 'completed')$$,
  'ARU-10 regression: an edited past meeting can be completed');
reset role;
select t.eq((select status::text from course_meetings where id = '00000000-0000-0000-0000-00000000f301'), 'completed',
  'ARU-10 regression: completed');

-- update_meeting is security definer with a fixed search_path.
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc where proname = 'update_meeting'),
  'data: update_meeting is security definer with search_path = public');
