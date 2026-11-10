-- ARU-125: meeting notes by listeners. Rules under test: supabase/migrations/0055_meeting_listener_notes.sql.
-- Course A owned by mentor M: S1 (student) and M2 (mentor) are listeners, S3 a student listener removed later.
-- Course B owned by N, hidden, S2 its listener. Meetings on A: C and C2 completed, F scheduled, X canceled; on B: D.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M')),
  (t.id('B'), t.id('S2'), t.id('N'));
update courses set hidden = true where id = t.id('B');
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  ('00000000-0000-0000-0000-0000000125c1', t.id('A'), now() - interval '3 days', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-0000000125c2', t.id('A'), now() - interval '2 days', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-0000000125f1', t.id('A'), now() + interval '1 day', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-0000000125a1', t.id('A'), now() - interval '1 day', 'canceled', t.id('M')),
  ('00000000-0000-0000-0000-0000000125d1', t.id('B'), now() - interval '1 day', 'completed', t.id('N'));

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
grant execute on function pg_temp.err(text) to authenticated, anon;

create function pg_temp.add(meeting text, body text) returns text language sql as $$
  -- ARU-143: published, so these notes keep the course-wide audience this test is about.
  select pg_temp.err(format('select add_meeting_listener_notes(%L, %L, true)', meeting, body)) $$;
create function pg_temp.upd(note uuid, body text) returns text language sql as $$
  select pg_temp.err(format('select update_meeting_listener_notes(%L, %L)', note, body)) $$;
create function pg_temp.del(note uuid) returns text language sql as $$
  select pg_temp.err(format('select delete_meeting_listener_notes(%L)', note)) $$;
-- The id of someone's note on a meeting, read as the admin.
create function pg_temp.note(who text, meeting text) returns uuid language sql security definer as $$
  select id from public.meeting_listener_notes where author_id = t.id(who) and meeting_id = meeting::uuid $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Data: the table, RLS, policies, realtime, nullable author with set null, no direct writes.
select t.ok((select relrowsecurity from pg_class where relname = 'meeting_listener_notes'), 'data: RLS is on');
select t.eq((select string_agg(cmd, ',' order by cmd) from pg_policies where tablename = 'meeting_listener_notes'
  and permissive = 'RESTRICTIVE'), 'DELETE,INSERT,SELECT', 'AC7 hidden-course restrictive policies (select, insert, delete)');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'meeting_listener_notes'),
  'AC8a the table is in supabase_realtime');
select t.eq((select is_nullable from information_schema.columns where table_name = 'meeting_listener_notes' and column_name = 'author_id'),
  'YES', 'AC12 author_id is nullable');
select t.eq((select confdeltype from pg_constraint where conrelid = 'meeting_listener_notes'::regclass and contype = 'f'
  and confrelid = 'profiles'::regclass), 'n'::"char", 'AC12 author_id on delete set null');
select t.ok(not has_table_privilege('authenticated', 'meeting_listener_notes', 'insert')
  and not has_table_privilege('authenticated', 'meeting_listener_notes', 'update')
  and not has_table_privilege('authenticated', 'meeting_listener_notes', 'delete'), 'data: no direct writes');
select t.ok(not has_function_privilege('anon', 'add_meeting_listener_notes(uuid, text, boolean)', 'execute'), 'data: anon cannot add');

-- AC 1-2: a student listener adds notes; the text is stored trimmed (spaces, tabs, line breaks, NBSP), signed.
select t.login('S1');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', E' \t\n' || chr(160) || '**Sam** wrote' || chr(160) || E'\n '),
  'no error', 'AC1 student listener adds notes');
reset role;
select t.ok((select body = '**Sam** wrote' and author_id = t.id('S1') and course_id = t.id('A') and updated_at = created_at
  from meeting_listener_notes where author_id = t.id('S1')), 'AC2 trimmed, signed, course from the meeting, not edited');

-- AC 1: a mentor listener adds notes too.
select t.login('M2');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', 'Mo''s notes'), 'no error', 'AC1 mentor listener adds notes');

-- AC 2 / 10: blank and too long are refused; exactly 10,000 is fine.
select t.login('S3');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', E'\t\n ' || chr(160) || chr(12288)),
  '23514 | Notes can''t be empty. | sham:listener_notes_empty', 'AC2 whitespace-only refused');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', repeat('a', 10001)),
  '22001 | Notes can be at most 10,000 characters. | sham:notes_too_long', 'AC10 10,001 characters refused');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', ' ' || repeat('a', 10000) || ' '), 'no error',
  'AC10 10,000 characters after trimming saved');

-- AC 3 / 10: one entry per listener and meeting.
select t.login('S1');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', 'Again'),
  '23505 | You already have notes for this meeting. | sham:listener_notes_exists', 'AC10 second note refused');

-- AC 5: scheduled and canceled meetings.
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125f1', 'x'),
  '23514 | Notes can be added only to completed meetings. | sham:notes_completed', 'AC5 scheduled meeting refused');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125a1', 'x'),
  '23514 | Notes can be added only to completed meetings. | sham:notes_completed', 'AC5 canceled meeting refused');

-- AC 10, changed by ARU-142 AC 2: the owner and the teacher write their own notes too; another mentor can't; a student
-- not in the course doesn't see the meeting.
select t.login('M');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', 'Owner''s notes'), 'no error', 'ARU-142 AC2 owner adds');
select t.login('T');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', 'Teacher''s notes'), 'no error', 'ARU-142 AC2 teacher adds');
select t.login('N');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', 'x'),
  '42501 | Only the course''s listeners, its owner and the teacher can add notes. | sham:notes_add_role', 'AC10 other mentor refused');
select t.login('S2');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', 'x'),
  'P0002 | Meeting not found. | sham:meeting_not_found', 'AC10 student not in the course refused');
select t.login(null);
select t.ok(pg_temp.add('00000000-0000-0000-0000-0000000125c1', 'x') like '42501 |%', 'signed out refused');
reset role;
-- A waiting account (X) that is still in the course list has no access.
update profiles set access_status = 'pending' where id = t.id('S3');
select t.login('S3');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c2', 'x'),
  'P0002 | Meeting not found. | sham:meeting_not_found', 'AC10 waiting account refused');
select t.eq((select count(*) from meeting_listener_notes), 0::bigint, 'AC10 waiting account reads nothing');
reset role;
update profiles set access_status = 'approved' where id = t.id('S3');

-- AC 6 / 7: who reads them.
-- 5 notes on C: S1, M2, S3, the owner M and the teacher T.
select t.login('S1');
select t.eq((select count(*) from meeting_listener_notes), 5::bigint, 'AC7 listener reads everyone''s notes');
select t.login('M');
select t.eq((select count(*) from meeting_listener_notes), 5::bigint, 'AC7 owner reads them');
select t.login('N');
select t.eq((select count(*) from meeting_listener_notes), 0::bigint, 'ARU-142 AC6 other mentor reads none');
select t.login('T');
select t.eq((select count(*) from meeting_listener_notes), 5::bigint, 'AC7 teacher reads them');
select t.login('S2');
select t.eq((select count(*) from meeting_listener_notes), 0::bigint, 'AC7 student not in the course reads none');

-- AC 7: hidden course B. Its listener adds; another mentor not in it and a student not in it can't read; the teacher can.
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125d1', 'Hidden notes'), 'no error', 'AC7 hidden course listener adds');
select t.login('M');
select t.eq((select count(*) from meeting_listener_notes where course_id = t.id('B')), 0::bigint,
  'AC7 mentor not in a hidden course reads none');
select t.eq(pg_temp.del(pg_temp.note('S2', '00000000-0000-0000-0000-0000000125d1')),
  'P0002 | Notes not found. | sham:listener_notes_not_found', 'AC7 mentor not in a hidden course can''t delete');
select t.login('S1');
select t.eq((select count(*) from meeting_listener_notes where course_id = t.id('B')), 0::bigint,
  'AC7 student not in a hidden course reads none');
select t.login('N');
select t.eq((select count(*) from meeting_listener_notes where course_id = t.id('B')), 1::bigint, 'AC7 hidden course owner reads');
select t.login('T');
select t.eq((select count(*) from meeting_listener_notes where course_id = t.id('B')), 1::bigint, 'AC7 teacher reads hidden');

-- AC 3 / 10: only the author edits; "Edited" (updated_at) only after a real change.
select t.login('S1');
select t.eq(pg_temp.upd(pg_temp.note('S1', '00000000-0000-0000-0000-0000000125c1'), '**Sam** wrote'), 'no error',
  'AC3 saving the same text is a no-op');
reset role;
select t.ok((select updated_at = created_at from meeting_listener_notes where author_id = t.id('S1')), 'AC3 no "Edited" for no change');
update meeting_listener_notes set created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour'
  where author_id = t.id('S1');
select t.login('S1');
select t.eq(pg_temp.upd(pg_temp.note('S1', '00000000-0000-0000-0000-0000000125c1'), '  Changed  '), 'no error', 'AC3 author edits');
reset role;
select t.ok((select body = 'Changed' and updated_at > created_at from meeting_listener_notes where author_id = t.id('S1')),
  'AC3 edited text trimmed, updated_at after created_at');
select t.login('S1');
select t.eq(pg_temp.upd(pg_temp.note('S1', '00000000-0000-0000-0000-0000000125c1'), E' \t'),
  '23514 | Notes can''t be empty. | sham:listener_notes_empty', 'AC2 edit to blank refused');
select t.eq(pg_temp.upd(pg_temp.note('M2', '00000000-0000-0000-0000-0000000125c1'), 'x'),
  '42501 | Only the author can edit these notes. | sham:listener_notes_author_only', 'AC10 listener edits another''s notes');
select t.eq(pg_temp.del(pg_temp.note('M2', '00000000-0000-0000-0000-0000000125c1')),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC10 listener deletes another''s notes');
select t.login('M');
select t.eq(pg_temp.upd(pg_temp.note('S1', '00000000-0000-0000-0000-0000000125c1'), 'x'),
  '42501 | Only the author can edit these notes. | sham:listener_notes_author_only', 'AC9 owner can''t edit');
select t.login('T');
select t.eq(pg_temp.upd(pg_temp.note('S1', '00000000-0000-0000-0000-0000000125c1'), 'x'),
  '42501 | Only the author can edit these notes. | sham:listener_notes_author_only', 'AC9 teacher can''t edit');
-- Direct writes are refused, even for the owner and the teacher.
select t.throws(format('update meeting_listener_notes set body = %L', 'direct'), '42501', 'data: direct update refused');
select t.throws(format('insert into meeting_listener_notes (meeting_id, course_id, author_id, body) values (%L, %L, %L, %L)',
  '00000000-0000-0000-0000-0000000125c2', t.id('B'), t.id('T'), 'x'), '42501', 'data: direct insert refused');
reset role;
-- The course is always the meeting's, whatever is written (even as the admin).
insert into meeting_listener_notes (meeting_id, course_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000125c2', t.id('B'), t.id('M2'), 'Mismatch');
select t.eq((select course_id from meeting_listener_notes where body = 'Mismatch'), t.id('A'), 'AC10 course comes from the meeting');
delete from meeting_listener_notes where body = 'Mismatch';

-- AC 11: S3 (student) and M2 (mentor) are removed from A.
delete from course_members where course_id = t.id('A') and user_id in (t.id('S3'), t.id('M2'));
select t.login('S1');
select t.eq((select count(*) from meeting_listener_notes where course_id = t.id('A')), 5::bigint,
  'AC11 removed listeners'' notes stay visible to others');
select t.login('S3');
-- ARU-143: an author always reads their own notes; nobody else's once removed.
select t.eq((select count(*) from meeting_listener_notes), 1::bigint, 'AC11 removed student sees only their own notes');
select t.eq(pg_temp.upd(pg_temp.note('S3', '00000000-0000-0000-0000-0000000125c1'), 'x'),
  '42501 | Only the course''s listeners, its owner and the teacher can edit notes. | sham:notes_edit_role', 'AC11 removed student update refused');
select t.eq(pg_temp.del(pg_temp.note('S3', '00000000-0000-0000-0000-0000000125c1')),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC11 removed student delete refused');
select t.login('M2');
-- ARU-142 AC6: a mentor who is neither the owner nor a listener reads no notes, their own included.
-- ARU-143 (supersedes ARU-142 here): an author always reads their own notes.
select t.eq((select count(*) from meeting_listener_notes where author_id = t.id('M2')), 1::bigint,
  'ARU-143 removed mentor reads their own notes');
select t.eq((select count(*) from meeting_listener_notes where author_id is distinct from t.id('M2')), 0::bigint,
  'ARU-142 AC6 removed mentor reads no one else''s notes');
select t.eq(pg_temp.upd(pg_temp.note('M2', '00000000-0000-0000-0000-0000000125c1'), 'x'),
  '42501 | Only the course''s listeners, its owner and the teacher can edit notes. | sham:notes_edit_role', 'AC11 removed mentor update refused');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c2', 'x'),
  '42501 | Only the course''s listeners, its owner and the teacher can add notes. | sham:notes_add_role', 'AC11 removed mentor add refused');
select t.eq(pg_temp.del(pg_temp.note('M2', '00000000-0000-0000-0000-0000000125c1')), 'no error', 'AC11 removed mentor deletes own');

-- AC 9: moderation. The owner deletes the removed student's notes; another mentor can't; after a change of owner the
-- old owner can't and the new one can; the teacher always can.
select t.login('N');
select t.eq(pg_temp.del(pg_temp.note('S3', '00000000-0000-0000-0000-0000000125c1')),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC9 other mentor can''t delete');
select t.login('M');
select t.eq(pg_temp.del(pg_temp.note('S3', '00000000-0000-0000-0000-0000000125c1')), 'no error', 'AC9 owner deletes');
select t.login('S1');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c2', 'Second meeting'), 'no error', 'S1 adds notes on C2');
reset role;
update courses set created_by = t.id('N') where id = t.id('A');
select t.login('M');
select t.eq(pg_temp.del(pg_temp.note('S1', '00000000-0000-0000-0000-0000000125c2')),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC9 previous owner can''t delete');
select t.login('N');
select t.eq(pg_temp.del(pg_temp.note('S1', '00000000-0000-0000-0000-0000000125c2')), 'no error', 'AC9 new owner deletes');
select t.login('T');
select t.eq(pg_temp.del(pg_temp.note('S2', '00000000-0000-0000-0000-0000000125d1')), 'no error', 'AC9 teacher deletes on any course');
select t.eq(pg_temp.del(gen_random_uuid()), 'P0002 | Notes not found. | sham:listener_notes_not_found', 'deleting a missing note');

-- AC 4: the author deletes their own.
select t.login('S1');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c2', 'Again'), 'no error', 'AC4 add after the owner deleted');
select t.eq(pg_temp.del(pg_temp.note('S1', '00000000-0000-0000-0000-0000000125c2')), 'no error', 'AC4 author deletes own');
select t.eq((select count(*) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-0000000125c2'), 0::bigint,
  'AC4 gone');

-- AC 12: deleted accounts. S1 and S2 delete their accounts; their notes stay with no author, two on one meeting.
reset role;
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S2'), t.id('N'));
select t.login('S2');
select t.eq(pg_temp.add('00000000-0000-0000-0000-0000000125c1', 'Sue''s'), 'no error', 'S2 adds notes on C');
reset role;
delete from auth.users where id in (t.id('S1'), t.id('S2'));
select t.eq((select count(*) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-0000000125c1'
  and author_id is null), 2::bigint, 'AC12 two deleted-account notes stay on one meeting');
