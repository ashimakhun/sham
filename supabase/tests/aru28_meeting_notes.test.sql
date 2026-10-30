-- ARU-28: notes on completed meetings. Rules under test: supabase/migrations/0012_meeting_notes.sql.
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

-- Data: new nullable columns, no update policy, existing rows have no notes, function not executable by anon.
select t.eq((select count(*) from information_schema.columns where table_name = 'course_meetings'
  and column_name in ('notes', 'notes_updated_by', 'notes_updated_at') and is_nullable = 'YES'), 3::bigint, 'data: three nullable columns');
select t.eq((select count(*) from pg_policies where tablename = 'course_meetings' and cmd in ('UPDATE', 'ALL')), 0::bigint,
  'data: still no update policy on course_meetings');
select t.eq((select count(*) from course_meetings where notes is not null or notes_updated_by is not null), 0::bigint,
  'data: existing meetings have no notes');
select t.ok(not has_function_privilege('anon', 'set_meeting_notes(uuid, text)', 'execute'), 'data: anon cannot run set_meeting_notes');
select t.ok(has_function_privilege('authenticated', 'set_meeting_notes(uuid, text)', 'execute'), 'data: authenticated can run set_meeting_notes');

-- AC 3 / 5: the owner saves notes on C; text trimmed, editor and time recorded.
select t.login('M');
select t.lives($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', '  **Covered** chapter 1  ')$$, 'AC3 owner saves notes');
reset role;
select t.ok((select notes = '**Covered** chapter 1' and notes_updated_by = t.id('M') and notes_updated_at is not null
  from course_meetings where id = '00000000-0000-0000-0000-00000000f281'), 'AC5 notes trimmed; editor and time recorded');

-- AC 7: everyone who sees the meeting reads the notes; a non-listener student doesn't.
select t.login('S1');
select t.eq((select notes from course_meetings where id = '00000000-0000-0000-0000-00000000f281'), '**Covered** chapter 1', 'AC7 listener reads notes');
select t.login('N');
select t.eq((select notes from course_meetings where id = '00000000-0000-0000-0000-00000000f281'), '**Covered** chapter 1', 'AC7 other mentor reads notes');
select t.login('S2');
select t.eq((select count(*) from course_meetings where id = '00000000-0000-0000-0000-00000000f281'), 0::bigint, 'AC7 non-listener student sees no meeting');
reset role;

-- The teacher edits notes on any course (last save wins).
select t.login('T');
select t.lives($$select set_meeting_notes('00000000-0000-0000-0000-00000000f285', 'Teacher note')$$, 'teacher saves notes on any course');
select t.lives($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', 'Teacher edit')$$, 'teacher edits the owner''s notes');
reset role;
select t.ok((select notes = 'Teacher edit' and notes_updated_by = t.id('T') from course_meetings where id = '00000000-0000-0000-0000-00000000f281'),
  'last save wins; editor updated');

-- AC 9: other mentors, mentor listeners and students are rejected; nothing changes.
select t.login('N');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', 'x')$$, '42501', 'AC9 other mentor rejected');
select t.login('M2');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', 'x')$$, '42501', 'AC9 mentor listener rejected');
select t.login('S1');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', 'x')$$, '42501', 'AC9 student listener rejected');
select t.login('M');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f285', 'x')$$, '42501', 'AC9 owner of A rejected on B');
-- AC 9: a direct update changes no row, even for the owner and the teacher.
select t.eq(t.affected($$update course_meetings set notes = 'direct' where id = '00000000-0000-0000-0000-00000000f281'$$), 0::bigint,
  'AC9 direct update by the owner changes nothing');
select t.login('T');
select t.eq(t.affected($$update course_meetings set notes = 'direct' where id = '00000000-0000-0000-0000-00000000f281'$$), 0::bigint,
  'AC9 direct update by the teacher changes nothing');
select t.login(null);
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', 'x')$$, '42501', 'AC9 signed out cannot call the function');
reset role;
select t.eq((select notes from course_meetings where id = '00000000-0000-0000-0000-00000000f281'), 'Teacher edit', 'AC9 rejected changes changed nothing');

-- AC 10: Scheduled (future and past) and Canceled meetings reject notes.
select t.login('M');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f282', 'x')$$, '23514', 'AC10 future scheduled rejected');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f283', 'x')$$, '23514', 'AC10 started scheduled rejected');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f284', 'x')$$, '23514', 'AC10 canceled rejected');
do $$ begin
  perform set_meeting_notes('00000000-0000-0000-0000-00000000f284', 'x');
exception when others then
  perform t.eq(sqlerrm, 'Notes can be added only to completed meetings.', 'AC10 message');
end $$;
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-0000000fffff', 'x')$$, 'P0002', 'unknown meeting → not found');

-- AC 10 / insert path: a new meeting can't come with notes.
select t.lives($$insert into course_meetings (id, course_id, starts_at, created_by, notes, notes_updated_by, notes_updated_at) values
  ('00000000-0000-0000-0000-00000000f286', '00000000-0000-0000-0000-0000000000d1', now() + interval '4 days',
   '00000000-0000-0000-0000-0000000000b1', 'sneaky', '00000000-0000-0000-0000-0000000000a1', now())$$, 'insert with notes goes through');
reset role;
select t.ok((select notes is null and notes_updated_by is null and notes_updated_at is null from course_meetings
  where id = '00000000-0000-0000-0000-00000000f286'), '...but the notes columns are cleared');

-- AC 6: length limit (exactly 10,000 accepted, 10,001 rejected, multibyte counted as characters); blank clears.
select t.login('M');
select t.lives($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', repeat('a', 10000))$$, 'AC6 exactly 10,000 chars accepted');
-- Multibyte text counts characters, not bytes (only meaningful on a UTF8 database, as on Supabase).
do $$ begin
  if current_setting('server_encoding') = 'UTF8' then
    perform set_meeting_notes('00000000-0000-0000-0000-00000000f281', repeat('é', 10000));
  end if;
  raise notice 'ok - AC6 10,000 multibyte characters accepted (UTF8 only)';
end $$;
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', repeat('a', 10001))$$, '22001', 'AC6 10,001 chars rejected');
select t.lives($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', E'  \n\t ')$$, 'AC6 whitespace-only save');
reset role;
select t.ok((select notes is null and notes_updated_by = t.id('M') from course_meetings where id = '00000000-0000-0000-0000-00000000f281'),
  'AC6 whitespace-only removes the notes');
select t.throws($$update course_meetings set notes = repeat('a', 10001) where id = '00000000-0000-0000-0000-00000000f281'$$, '23514',
  'AC6 the column check rejects longer text even for the admin');

-- Owner change (ARU-9): the new owner can edit, the former owner can't; "last edited by" keeps the earlier editor.
select t.login('M');
select t.lives($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', 'By Max')$$, 'owner M saves before handover');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2')$$, 'ownership of A moves to N');
reset role;
select t.eq((select notes_updated_by from course_meetings where id = '00000000-0000-0000-0000-00000000f281'), t.id('M'), 'editor kept after owner change');
select t.login('M');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', 'x')$$, '42501', 'AC9 former owner rejected');
select t.login('N');
select t.lives($$select set_meeting_notes('00000000-0000-0000-0000-00000000f281', 'By Nina')$$, 'new owner edits notes');
reset role;

-- Status changes and edits still work with the new columns.
select t.login('N');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000000f283', 'completed')$$, 'regression: mark completed still works');
select t.lives($$select set_meeting_notes('00000000-0000-0000-0000-00000000f283', 'Now completed')$$, 'notes allowed once completed');
reset role;
