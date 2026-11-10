-- ARU-28: notes on completed meetings, retired by ARU-142 (supabase/migrations/0057_one_kind_of_notes.sql).
-- Official notes can no longer be written: set_meeting_notes() is revoked. The columns and the insert trigger stay as
-- a backup (ARU-142 AC 10). Meeting notes are now the signed notes of meeting_listener_notes (aru142_one_kind_of_notes).
-- Course A owned by mentor M; course B owned by N; S1 a student listener of A, M2 a mentor listener of A.
-- Meetings on A (inserted as the admin): C completed, F future scheduled, P past unmarked, X canceled; D completed on B.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));
insert into course_meetings (id, course_id, starts_at, topic, status, created_by) values
  ('00000000-0000-0000-0000-00000000f281', t.id('A'), now() - interval '2 days', 'Done', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000000f282', t.id('A'), now() + interval '1 day', 'Future', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f283', t.id('A'), now() - interval '1 hour', 'Past', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f284', t.id('A'), now() - interval '3 days', 'Dropped', 'canceled', t.id('M')),
  ('00000000-0000-0000-0000-00000000f285', t.id('B'), now() - interval '2 days', 'B done', 'completed', t.id('N'));

-- ARU-142 AC 10: the backup columns stay, nullable; still no update policy on course_meetings.
select t.eq((select count(*) from information_schema.columns where table_name = 'course_meetings'
  and column_name in ('notes', 'notes_updated_by', 'notes_updated_at') and is_nullable = 'YES'), 3::bigint, 'data: three nullable columns kept');
select t.eq((select count(*) from pg_policies where tablename = 'course_meetings' and cmd in ('UPDATE', 'ALL')), 0::bigint,
  'data: still no update policy on course_meetings');
select t.ok(exists (select 1 from pg_trigger where tgname = 'course_meetings_new_no_notes'), 'ARU-142 AC10 the insert trigger is kept');

-- ARU-142 AC 1: nobody can run set_meeting_notes any more.
select t.ok(not has_function_privilege('anon', 'set_meeting_notes(uuid, text)', 'execute'), 'data: anon cannot run set_meeting_notes');
select t.ok(not has_function_privilege('authenticated', 'set_meeting_notes(uuid, text)', 'execute'),
  'ARU-142 AC1 authenticated cannot run set_meeting_notes');
select t.login('M');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', 'x')$$, '42501', 'ARU-142 AC1 the owner can''t write official notes');
select t.login('T');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f285', 'x')$$, '42501', 'ARU-142 AC1 the teacher can''t either');
-- A direct update changes no row, even for the owner and the teacher.
select t.eq(t.affected($$update course_meetings set notes = 'direct' where id = '00000000-0000-0000-0000-00000000f281'$$), 0::bigint,
  'direct update by the teacher changes nothing');
select t.login('M');
select t.eq(t.affected($$update course_meetings set notes = 'direct' where id = '00000000-0000-0000-0000-00000000f281'$$), 0::bigint,
  'direct update by the owner changes nothing');
reset role;
select t.ok((select notes is null from course_meetings where id = '00000000-0000-0000-0000-00000000f281'), 'no official notes were written');

-- The insert path still can't bring notes along.
select t.login('M');
select t.lives($$insert into course_meetings (id, course_id, starts_at, created_by, notes, notes_updated_by, notes_updated_at) values
  ('00000000-0000-0000-0000-00000000f286', '00000000-0000-0000-0000-0000000000d1', now() + interval '4 days',
   '00000000-0000-0000-0000-0000000000b1', 'sneaky', '00000000-0000-0000-0000-0000000000a1', now())$$, 'insert with notes goes through');
reset role;
select t.ok((select notes is null and notes_updated_by is null and notes_updated_at is null from course_meetings
  where id = '00000000-0000-0000-0000-00000000f286'), '...but the notes columns are cleared');
select t.throws($$update course_meetings set notes = repeat('a', 10001) where id = '00000000-0000-0000-0000-00000000f281'$$, '23514',
  'the column check still rejects longer text even for the admin');

-- The same people now write meeting notes with add_meeting_listener_notes: the owner and the teacher on C.
select t.login('M');
select t.lives($$select add_meeting_listener_notes('00000000-0000-0000-0000-00000000f281', 'By Max')$$, 'ARU-142 the owner writes notes');
select t.login('T');
select t.lives($$select add_meeting_listener_notes('00000000-0000-0000-0000-00000000f285', 'Teacher note')$$, 'ARU-142 the teacher writes notes on any course');

-- Status changes still work.
select t.login('M');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f283', 'completed')$$, 'regression: mark completed still works');
reset role;
