-- ARU-129: meetings have no topic in the app. A new meeting stores the column default 'Meeting'; Edit sends the
-- stored topic back unchanged, so an old topic survives an edit of the place or the time. No migration.
-- Course A owned by mentor M. Meetings (inserted as the admin): O an old meeting with topic 'Algebra', D one with
-- the default topic.
select t.seed();
insert into course_meetings (id, course_id, starts_at, topic, location, status, created_by) values
  ('00000000-0000-0000-0000-00000000f291', t.id('A'), now() + interval '1 day', 'Algebra', 'Room 1', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f292', t.id('A'), now() + interval '2 days', 'Meeting', null, 'scheduled', t.id('M'));

-- AC 5: the topic column and its default are unchanged.
select t.eq((select column_default from information_schema.columns where table_name = 'course_meetings' and column_name = 'topic'),
  '''Meeting''::text', 'AC5 topic column keeps its default ''Meeting''');

-- AC 6: a new meeting without a topic (as the app inserts it) stores 'Meeting'.
select t.login('M');
select t.lives($$insert into course_meetings (id, course_id, starts_at, location, created_by) values
  ('00000000-0000-0000-0000-00000000f293', '00000000-0000-0000-0000-0000000000d1', now() + interval '3 days', 'Room 2',
   '00000000-0000-0000-0000-0000000000b1')$$, 'AC6 owner schedules a meeting without a topic');
reset role;
select t.eq((select topic from course_meetings where id = '00000000-0000-0000-0000-00000000f293'), 'Meeting',
  'AC6 a new meeting stores the default topic');

-- AC 6: edit only the place of the old meeting, sending its stored topic: the topic stays, not rescheduled.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f291',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f291'), 'Algebra', 'Room 9')$$,
  'AC6 owner edits the place only');
reset role;
select t.eq((select topic || '|' || location || '|' || (rescheduled_at is null)::text from course_meetings
  where id = '00000000-0000-0000-0000-00000000f291'), 'Algebra|Room 9|true', 'AC6 place-only edit keeps the topic; not rescheduled');

-- AC 6: edit only the time: the topic still stays, and the meeting is rescheduled.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f291', now() + interval '5 days', 'Algebra', 'Room 9')$$,
  'AC6 owner edits the time only');
reset role;
select t.eq((select topic || '|' || (rescheduled_at is not null)::text from course_meetings
  where id = '00000000-0000-0000-0000-00000000f291'), 'Algebra|true', 'AC6 time-only edit keeps the topic; rescheduled');

-- AC 6: a meeting with the default topic keeps 'Meeting'.
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f292',
  (select starts_at from course_meetings where id = '00000000-0000-0000-0000-00000000f292'), 'Meeting', 'Room 3')$$,
  'AC6 owner edits a default-topic meeting');
reset role;
select t.eq((select topic from course_meetings where id = '00000000-0000-0000-0000-00000000f292'), 'Meeting',
  'AC6 default topic stays ''Meeting''');
