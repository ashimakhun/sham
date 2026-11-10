-- ARU-142: one kind of meeting notes. Rules under test: supabase/migrations/0057_one_kind_of_notes.sql.
-- Course A owned by mentor M: S1 (student) and M2 (mentor) are listeners. Course B owned by N. Meetings on A: c1-c9
-- completed (official notes seeded as the admin, then copied with copy_official_notes(), as the migration does), cs
-- scheduled.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));
create function t.mt(n text) returns uuid language sql immutable as $$ select md5('aru142' || n)::uuid $$;
grant execute on function t.mt(text) to anon, authenticated;
insert into course_meetings (id, course_id, starts_at, status, created_by)
  select t.mt(n), t.id('A'), now() - (i || ' days')::interval, 'completed', t.id('M')
  from unnest(array['c1','c2','c3','c4','c5','c6','c7','c8','c9']) with ordinality as x(n, i);
insert into course_meetings (id, course_id, starts_at, status, created_by)
  values (t.mt('cs'), t.id('A'), now() + interval '1 day', 'scheduled', t.id('M'));

-- What a statement raises: errcode | message | hint (or 'no error').
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; msg text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, msg = message_text, hint = pg_exception_hint;
  return concat_ws(' | ', code, msg, hint);
end $$;
create function pg_temp.add(meeting uuid, body text) returns text language sql as $$
  select pg_temp.err(format('select add_meeting_listener_notes(%L, %L)', meeting, body)) $$;
create function pg_temp.upd(note uuid, body text) returns text language sql as $$
  select pg_temp.err(format('select update_meeting_listener_notes(%L, %L)', note, body)) $$;
create function pg_temp.del(note uuid) returns text language sql as $$
  select pg_temp.err(format('select delete_meeting_listener_notes(%L)', note)) $$;
create function pg_temp.note(who text, meeting uuid) returns uuid language sql security definer as $$
  select id from public.meeting_listener_notes where author_id = t.id(who) and meeting_id = meeting $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Seed official notes and some existing signed notes (as the admin).
update course_meetings set notes = ' Official by Tess ', notes_updated_by = t.id('T'),
  notes_updated_at = now() - interval '5 days' + interval '1 hour' where id = t.mt('c1');
update course_meetings set notes = 'Gone editor one', notes_updated_by = null, notes_updated_at = now() - interval '2 days'
  where id = t.mt('c2');
update course_meetings set notes = 'Gone editor two', notes_updated_by = null, notes_updated_at = now() - interval '3 days'
  where id = t.mt('c3');
-- c4: M's own notes were edited after the official ones; c5: the official ones are later.
insert into meeting_listener_notes (meeting_id, course_id, author_id, body, created_at, updated_at) values
  (t.mt('c4'), t.id('A'), t.id('M'), 'Max mine', now() - interval '10 days', now() - interval '1 day'),
  (t.mt('c5'), t.id('A'), t.id('M'), 'Max older', now() - interval '10 days', now() - interval '9 days'),
  (t.mt('c6'), t.id('A'), t.id('M'), repeat('a', 9000), now() - interval '10 days', now() - interval '10 days');
update course_meetings set notes = 'Official four', notes_updated_by = t.id('M'), notes_updated_at = now() - interval '3 days'
  where id = t.mt('c4');
update course_meetings set notes = 'Official five', notes_updated_by = t.id('M'), notes_updated_at = now() - interval '2 days'
  where id = t.mt('c5');
update course_meetings set notes = repeat('b', 9000), notes_updated_by = t.id('M'), notes_updated_at = now() - interval '5 days'
  where id = t.mt('c6');
update course_meetings set notes = chr(160) || E'\t Trim me \n' || chr(160), notes_updated_by = t.id('M'),
  notes_updated_at = now() - interval '6 days' where id = t.mt('c7');
update course_meetings set notes = E' \t' || chr(160) || E'\n', notes_updated_by = t.id('M'),
  notes_updated_at = now() - interval '7 days' where id = t.mt('c8');
update course_meetings set notes = 'No time', notes_updated_by = t.id('M'), notes_updated_at = null where id = t.mt('c9');

select copy_official_notes();

-- AC 9: the copy.
select t.ok((select body = 'Official by Tess' and created_at = updated_at
  and created_at = (select notes_updated_at from course_meetings where id = t.mt('c1'))
  from meeting_listener_notes where meeting_id = t.mt('c1') and author_id = t.id('T')),
  'AC9 a new note signed by the editor, trimmed, dated at the official edit, no "Edited"');
select t.eq((select count(*) from meeting_listener_notes where meeting_id in (t.mt('c2'), t.mt('c3')) and author_id is null),
  2::bigint, 'AC9 a deleted editor gives a "Deleted account" note on each meeting');
select t.ok((select body = E'Max mine\n\nOfficial four' and created_at::date = (now() - interval '10 days')::date
  and updated_at::date = (now() - interval '1 day')::date
  from meeting_listener_notes where meeting_id = t.mt('c4') and author_id = t.id('M')),
  'AC9 merge: appended after a blank line, created_at kept, updated_at the later (own edit)');
select t.ok((select body = E'Max older\n\nOfficial five' and updated_at::date = (now() - interval '2 days')::date
  from meeting_listener_notes where meeting_id = t.mt('c5') and author_id = t.id('M')),
  'AC9 merge: updated_at the later (official edit)');
select t.eq((select char_length(body) from meeting_listener_notes where meeting_id = t.mt('c6') and author_id = t.id('M')),
  18002, 'AC9 a merged note over 10,000 characters is kept whole');
select t.eq((select body from meeting_listener_notes where meeting_id = t.mt('c7')), 'Trim me',
  'AC9 NBSP, tabs and line breaks around the text are trimmed');
select t.eq((select count(*) from meeting_listener_notes where meeting_id = t.mt('c8')), 0::bigint,
  'AC9 whitespace-only official notes are skipped');
select t.ok((select created_at = updated_at and created_at = (select starts_at from course_meetings where id = t.mt('c9'))
  from meeting_listener_notes where meeting_id = t.mt('c9')), 'AC9 no edit time: dated at the meeting''s start');
select t.eq((select count(*) from meeting_listener_notes where author_id = t.id('M')), 5::bigint,
  'AC9 one entry per person and meeting (merged, not duplicated)');

-- AC 10: the backup columns keep their data.
select t.eq((select notes from course_meetings where id = t.mt('c4')), 'Official four', 'AC10 old notes kept as a backup');

-- AC 1 and the data rules.
select t.ok(not has_function_privilege('authenticated', 'set_meeting_notes(uuid, text)', 'execute'), 'AC1 set_meeting_notes revoked');
select t.ok(not has_function_privilege('authenticated', 'copy_official_notes()', 'execute')
  and not has_function_privilege('anon', 'copy_official_notes()', 'execute'), 'data: app users can''t run the copy');
select t.throws(format('insert into meeting_listener_notes (meeting_id, course_id, author_id, body) values (%L, %L, %L, %L)',
  t.mt('c8'), t.id('A'), t.id('S2'), repeat('x', 20003)), '23514', 'AC9 the body check stops at 20,002');
select t.throws(format('insert into meeting_listener_notes (meeting_id, course_id, author_id, body) values (%L, %L, %L, %L)',
  t.mt('c8'), t.id('A'), t.id('S2'), ' x'), '23514', 'data: the body check still requires trimmed text');

-- AC 9: an over-limit note must be shortened before it can be saved; nothing is cut meanwhile.
select t.login('M');
select t.eq(pg_temp.upd(pg_temp.note('M', t.mt('c6')), repeat('a', 9000) || E'\n\n' || repeat('b', 9000) || '!'),
  '22001 | Notes can be at most 10,000 characters. | sham:notes_too_long', 'AC9 saving it still over 10,000 is refused');
select t.eq(pg_temp.upd(pg_temp.note('M', t.mt('c6')), repeat('a', 10000)), 'no error', 'AC9 shortened to 10,000 it saves');

-- AC 2: writers. A listener (student and mentor), the owner and the teacher add; one entry each.
select t.login('S1');
select t.eq(pg_temp.add(t.mt('c1'), 'Sam''s'), 'no error', 'AC2 student listener adds');
select t.login('M2');
select t.eq(pg_temp.add(t.mt('c1'), 'Mo''s'), 'no error', 'AC2 mentor listener adds');
select t.login('M');
select t.eq(pg_temp.add(t.mt('c1'), 'Max''s'), 'no error', 'AC2 the owner adds');
select t.login('T');
select t.eq(pg_temp.add(t.mt('c1'), 'Again'),
  '23505 | You already have notes for this meeting. | sham:listener_notes_exists', 'AC2 one entry per person (the migrated one)');
select t.eq(pg_temp.upd(pg_temp.note('T', t.mt('c1')), 'Tess edits'), 'no error', 'AC2 the teacher edits their migrated notes');
select t.eq(pg_temp.add(t.mt('cs'), 'x'),
  '23514 | Notes can be added only to completed meetings. | sham:notes_completed', 'AC2 a scheduled meeting is refused');
select t.login('N');
select t.eq(pg_temp.add(t.mt('c1'), 'x'),
  '42501 | Only the course''s listeners, its owner and the teacher can add notes. | sham:notes_add_role',
  'AC2 a mentor outside the course is refused');
select t.login('S2');
select t.eq(pg_temp.add(t.mt('c1'), 'x'), 'P0002 | Meeting not found. | sham:meeting_not_found',
  'AC2 a student outside the course doesn''t see the meeting');

-- AC 6: readers.
select t.login('S1');
select t.eq((select count(*) from meeting_listener_notes where meeting_id = t.mt('c1')), 4::bigint, 'AC6 a listener reads every note');
select t.login('M');
select t.eq((select count(*) from meeting_listener_notes where meeting_id = t.mt('c1')), 4::bigint, 'AC6 the owner reads them');
select t.login('T');
select t.eq((select count(*) from meeting_listener_notes where meeting_id = t.mt('c1')), 4::bigint, 'AC6 the teacher reads them');
select t.login('N');
select t.eq((select count(*) from meeting_listener_notes), 0::bigint, 'AC6 a mentor outside the course reads none');
select t.login('S2');
select t.eq((select count(*) from meeting_listener_notes), 0::bigint, 'AC6 a student outside the course reads none');

-- Edge: a change of owner. The former owner stops writing and reading; the new one starts.
reset role;
update courses set created_by = t.id('N') where id = t.id('A');
select t.login('M');
select t.eq((select count(*) from meeting_listener_notes), 0::bigint, 'edge: the former owner reads none');
select t.eq(pg_temp.upd(pg_temp.note('M', t.mt('c1')), 'x'),
  '42501 | Only the course''s listeners, its owner and the teacher can edit notes. | sham:notes_edit_role',
  'edge: the former owner can''t edit their notes');
select t.eq(pg_temp.add(t.mt('c2'), 'x'),
  '42501 | Only the course''s listeners, its owner and the teacher can add notes. | sham:notes_add_role',
  'edge: the former owner can''t add');
select t.login('N');
select t.eq(pg_temp.add(t.mt('c1'), 'Nina''s'), 'no error', 'edge: the new owner adds');
select t.eq((select count(*) from meeting_listener_notes where meeting_id = t.mt('c1')), 5::bigint, 'edge: the new owner reads all');

-- AC 8: delete rules as ARU-125. A listener can't delete another's; the owner and the teacher can; a deleted account's
-- notes only by the owner or the teacher.
select t.login('S1');
select t.eq(pg_temp.del(pg_temp.note('M2', t.mt('c1'))),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC8 a listener can''t delete another''s');
select t.eq(pg_temp.del((select id from meeting_listener_notes where meeting_id = t.mt('c2'))),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC8 a listener can''t delete a deleted account''s');
select t.eq(pg_temp.del(pg_temp.note('S1', t.mt('c1'))), 'no error', 'AC8 the author deletes their own');
select t.login('N');
select t.eq(pg_temp.del(pg_temp.note('M2', t.mt('c1'))), 'no error', 'AC8 the owner deletes another''s');
select t.eq(pg_temp.del((select id from meeting_listener_notes where meeting_id = t.mt('c2'))), 'no error',
  'AC8 the owner deletes a deleted account''s');
select t.login('T');
select t.eq(pg_temp.del((select id from meeting_listener_notes where meeting_id = t.mt('c3'))), 'no error',
  'AC8 the teacher deletes a deleted account''s');
reset role;
