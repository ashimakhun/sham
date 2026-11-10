-- QA ARU-142: gaps in aru142_one_kind_of_notes.test.sql: hidden courses (AC 6 "hidden-course rules stay"), a Pending
-- listener, a removed listener (student and mentor), the teacher who owns the course, a migrated note whose author then
-- deletes their account, direct writes still revoked, set_meeting_notes() refused for the owner and the teacher, and
-- copy_official_notes() closed to app users. (The real 0057 file was also applied to data seeded at 0056 outside this
-- suite: 2 new + 2 merged rows, a 20,002-character merge, whitespace skipped, backup columns untouched.)
-- Fixture (t.seed): course A owned by M, B by N; teacher T. Added: listeners S1, M2 on A; hidden course H owned by N
-- with listener S2; course TC owned by the teacher T; a Pending student P listed on A.
select t.seed();
create function t.q(n text) returns uuid language sql immutable as $$ select md5('aru142qa' || n)::uuid $$;
grant execute on function t.q(text) to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data) values (t.q('P'), 'p@x.test', '{"full_name":"Pending Pat"}');
insert into courses (id, title, created_by, hidden) values
  (t.q('H'), 'Hidden lab', t.id('N'), true),
  (t.q('TC'), 'Teacher course', t.id('T'), false);
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.q('P'), t.id('M')),
  (t.q('H'), t.id('S2'), t.id('N'));
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.q('a1'), t.id('A'), now() - interval '3 days', 'completed', t.id('M')),
  (t.q('a2'), t.id('A'), now() - interval '2 days', 'completed', t.id('M')),
  (t.q('h1'), t.q('H'), now() - interval '3 days', 'completed', t.id('N')),
  (t.q('t1'), t.q('TC'), now() - interval '3 days', 'completed', t.id('T'));

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
create function pg_temp.note(who uuid, meeting uuid) returns uuid language sql security definer as $$
  select id from public.meeting_listener_notes where author_id = who and meeting_id = meeting $$;
create function pg_temp.seen(meeting uuid) returns bigint language sql as $$
  select count(*) from public.meeting_listener_notes where meeting_id = meeting $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- A migrated official note on a2 by S1 (S1 later deletes the account), copied as the migration does.
update course_meetings set notes = 'Official by Sam', notes_updated_by = t.id('S1'),
  notes_updated_at = now() - interval '2 days' where id = t.q('a2');
select copy_official_notes();
select t.eq((select count(*) from meeting_listener_notes where meeting_id = t.q('a2') and author_id = t.id('S1')), 1::bigint,
  'setup: the official note on a2 is signed by its editor');

-- AC 1: official notes can't be written, by the owner or the teacher.
select t.login('M');
select t.ok(pg_temp.err(format('select set_meeting_notes(%L, %L)', t.q('a1'), 'x')) like '42501 |%',
  'AC1 the owner gets permission denied on set_meeting_notes()');
select t.login('T');
select t.ok(pg_temp.err(format('select set_meeting_notes(%L, %L)', t.q('a1'), 'x')) like '42501 |%',
  'AC1 the teacher gets permission denied on set_meeting_notes()');
select t.ok(pg_temp.err('select copy_official_notes()') like '42501 |%', 'data: the teacher can''t run copy_official_notes()');

-- Direct writes stay revoked: the functions are the only way in.
select t.login('S1');
select t.ok(pg_temp.err(format(
  'insert into meeting_listener_notes (meeting_id, course_id, author_id, body) values (%L, %L, %L, %L)',
  t.q('a1'), t.id('A'), t.id('S1'), 'direct')) like '42501 |%', 'data: a listener''s direct insert is refused');
select t.ok(pg_temp.err(format('update meeting_listener_notes set body = %L where id = %L', 'direct',
  pg_temp.note(t.id('S1'), t.q('a2')))) like '42501 |%', 'data: an author''s direct update is refused');

-- AC 2: the teacher who owns the course writes one entry, like anyone else.
select t.login('T');
select t.eq(pg_temp.add(t.q('t1'), 'Teacher-owner'), 'no error', 'AC2 the teacher who owns the course adds');
select t.eq(pg_temp.add(t.q('t1'), 'Again'),
  '23505 | You already have notes for this meeting. | sham:listener_notes_exists', 'AC2 still one entry for the teacher-owner');

-- AC 6: hidden courses. The teacher and the course's people read and write; an outsider mentor sees nothing.
select t.login('S2');
select t.eq(pg_temp.add(t.q('h1'), 'Hidden S2'), 'no error', 'AC6 hidden: its listener adds');
select t.login('N');
select t.eq(pg_temp.add(t.q('h1'), 'Hidden N'), 'no error', 'AC6 hidden: its owner adds');
select t.login('T');
select t.eq(pg_temp.add(t.q('h1'), 'Hidden T'), 'no error', 'AC6 hidden: the teacher adds');
select t.eq(pg_temp.seen(t.q('h1')), 3::bigint, 'AC6 hidden: the teacher reads all');
select t.login('M');
select t.eq(pg_temp.seen(t.q('h1')), 0::bigint, 'AC6 hidden: an outsider mentor reads none');
select t.eq(pg_temp.add(t.q('h1'), 'x'), 'P0002 | Meeting not found. | sham:meeting_not_found',
  'AC6 hidden: an outsider mentor adding gets "Meeting not found."');
select t.eq(pg_temp.upd(pg_temp.note(t.id('S2'), t.q('h1')), 'x'),
  'P0002 | Notes not found. | sham:listener_notes_not_found', 'AC6 hidden: an outsider editing learns nothing');
select t.login('S1');
select t.eq(pg_temp.seen(t.q('h1')), 0::bigint, 'AC6 hidden: a student outside it reads none');

-- AC 6: a Pending listener neither reads nor writes.
select t.login('S1');
select t.eq(pg_temp.add(t.q('a1'), 'Sam a1'), 'no error', 'setup: S1 adds on a1');
select t.login('M2');
select t.eq(pg_temp.add(t.q('a1'), 'Mo a1'), 'no error', 'setup: M2 adds on a1');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', t.q('P'), 'role', 'authenticated')::text, false);
set role authenticated;
select t.eq(pg_temp.seen(t.q('a1')), 0::bigint, 'AC6 a Pending listener reads none');
select t.ok(pg_temp.add(t.q('a1'), 'pending') <> 'no error', 'AC2 a Pending listener can''t add');

-- Edge: a removed listener loses access (student and mentor), and their notes stay for the others.
reset role;
delete from course_members where course_id = t.id('A') and user_id in (t.id('S1'), t.id('M2'));
select t.login('S1');
select t.eq(pg_temp.seen(t.q('a1')), 0::bigint, 'edge: a removed student reads none, not even their own');
select t.eq(pg_temp.upd(pg_temp.note(t.id('S1'), t.q('a1')), 'x'),
  '42501 | Only the course''s listeners, its owner and the teacher can edit notes. | sham:notes_edit_role',
  'edge: a removed student can''t edit their notes');
select t.login('M2');
select t.eq(pg_temp.seen(t.q('a1')), 0::bigint, 'edge: a removed mentor reads none (AC6: no "any mentor" rule)');
select t.eq(pg_temp.add(t.q('a2'), 'x'),
  '42501 | Only the course''s listeners, its owner and the teacher can add notes. | sham:notes_add_role',
  'edge: a removed mentor can''t add');
select t.login('M');
select t.eq(pg_temp.seen(t.q('a1')), 2::bigint, 'edge: the owner still reads the removed listeners'' notes');

-- AC 8 / ARU-135: a migrated note whose author deletes the account stays as "Deleted account", and only the owner or
-- the teacher can delete it.
reset role;
delete from auth.users where id = t.id('S1');
select t.login('M');
select t.eq((select count(*) from meeting_listener_notes where meeting_id = t.q('a2') and author_id is null), 1::bigint,
  'AC8 a migrated note survives its author''s account deletion, with no author');
select t.login('N');
select t.eq(pg_temp.del((select id from meeting_listener_notes where meeting_id = t.q('a2'))), 'P0002 | Notes not found. | sham:listener_notes_not_found',
  'AC8 a mentor outside the course can''t delete it (and doesn''t see it)');
select t.login('M');
select t.eq(pg_temp.del((select id from meeting_listener_notes where meeting_id = t.q('a2'))), 'no error',
  'AC8 the owner deletes a deleted account''s migrated note');
reset role;
