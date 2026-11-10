-- QA ARU-125: gaps in aru125_meeting_listener_notes.test.sql:
-- - AC 9: the owner and the teacher can't edit a listener's notes, and a mentor outside the course can't delete them;
-- - AC 10: a Pending or Declined listener can't add, edit or delete; a signed-out user can't call update or delete;
-- - AC 7: an outsider's update or delete on a hidden course's notes says "Notes not found." (nothing leaks);
-- - AC 12: deleting an account keeps its notes with no author, two such notes on one meeting coexist, nobody can
--   edit them, the owner and the teacher can still delete them;
-- - data: deleting the meeting or the course removes its notes; the trimmed body keeps inner non-breaking spaces;
--   an edit to 10,001 characters is refused; the helper and trigger functions aren't callable by app users; the
--   three write functions are security definer with search_path=public.
-- Fixture (t.seed): course A owned by M, B by N. Added: listeners S1, M2 on A; hidden course H owned by N with
-- listener S2; P (Pending) and D (Declined) listeners of A.
select t.seed();

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000012a0f1', 'p@x.test', '{"full_name":"Pending Pat"}'),
  ('00000000-0000-0000-0000-00000012a0f2', 'd@x.test', '{"full_name":"Declined Dan"}');
update profiles set access_status = 'pending' where id = '00000000-0000-0000-0000-00000012a0f1';
update profiles set access_status = 'rejected' where id = '00000000-0000-0000-0000-00000012a0f2';

insert into courses (id, title, created_by, hidden) values
  ('00000000-0000-0000-0000-00000012a0d1', 'Hidden lab', t.id('N'), true);
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M')),
  (t.id('A'), '00000000-0000-0000-0000-00000012a0f1', t.id('M')),
  (t.id('A'), '00000000-0000-0000-0000-00000012a0f2', t.id('M')),
  ('00000000-0000-0000-0000-00000012a0d1', t.id('S2'), t.id('N'));
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  ('00000000-0000-0000-0000-00000012a0c1', t.id('A'), now() - interval '3 days', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000012a0c2', t.id('A'), now() - interval '2 days', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000012a0c3', t.id('A'), now() - interval '1 day', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000012a0e1', '00000000-0000-0000-0000-00000012a0d1', now() - interval '1 day', 'completed', t.id('N'));

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
create function pg_temp.add(meeting text, body text) returns text language sql as $$
  select pg_temp.err(format('select add_meeting_listener_notes(%L, %L)', meeting, body)) $$;
create function pg_temp.upd(note uuid, body text) returns text language sql as $$
  select pg_temp.err(format('select update_meeting_listener_notes(%L, %L)', note, body)) $$;
create function pg_temp.del(note uuid) returns text language sql as $$
  select pg_temp.err(format('select delete_meeting_listener_notes(%L)', note)) $$;
-- The id of someone's note on a meeting (author by uuid; null for a deleted account's), read as the admin.
create function pg_temp.note(who uuid, meeting text) returns uuid language sql security definer as $$
  select id from public.meeting_listener_notes where author_id = who and meeting_id = meeting::uuid $$;
-- A deleted account's note on a meeting, read past RLS, so a caller who can't see it still gets its real id.
create function pg_temp.orphan(meeting text) returns uuid language sql security definer as $$
  select id from public.meeting_listener_notes where author_id is null and meeting_id = meeting::uuid limit 1 $$;
create function pg_temp.login_id(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Function settings.
select t.ok((select bool_and(prosecdef and proconfig @> array['search_path=public']) from pg_proc
  where proname in ('add_meeting_listener_notes', 'update_meeting_listener_notes', 'delete_meeting_listener_notes')),
  'data: the three write functions are security definer with search_path=public');
select t.ok(not has_function_privilege('authenticated', 'listener_notes_clean(text)', 'execute')
  and not has_function_privilege('authenticated', 'meeting_listener_notes_before_write()', 'execute'),
  'data: the helper and trigger functions are not callable by app users');

-- Notes to work with: S1 and M2 on C1, S1 on C2, S2 on the hidden course's meeting.
select t.login('S1');
select t.eq(pg_temp.add('00000000-0000-0000-0000-00000012a0c1', E'a' || chr(160) || chr(160) || 'b'), 'no error', 'setup: S1 adds on C1');
select t.eq(pg_temp.add('00000000-0000-0000-0000-00000012a0c2', 'S1 on C2'), 'no error', 'setup: S1 adds on C2');
reset role;
select t.login('M2');
select t.eq(pg_temp.add('00000000-0000-0000-0000-00000012a0c1', 'M2 on C1'), 'no error', 'setup: M2 adds on C1');
reset role;
select t.login('S2');
select t.eq(pg_temp.add('00000000-0000-0000-0000-00000012a0e1', 'S2 hidden'), 'no error', 'setup: S2 adds on the hidden course');
reset role;

select t.eq((select body from meeting_listener_notes where id = pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c1')),
  'a' || chr(160) || chr(160) || 'b', 'AC2 trimming keeps non-breaking spaces inside the text');

-- AC 9: the owner and the teacher delete but never edit.
select t.login('M');
select t.eq(pg_temp.upd(pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c1'), 'owner edit'),
  '42501 | Only the author can edit these notes. | sham:listener_notes_author_only', 'AC9 the owner can''t edit a listener''s notes');
reset role;
select t.login('T');
select t.eq(pg_temp.upd(pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c1'), 'teacher edit'),
  '42501 | Only the author can edit these notes. | sham:listener_notes_author_only', 'AC9 the teacher can''t edit a listener''s notes');
reset role;
select t.login('N');
select t.eq(pg_temp.del(pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c1')),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC10 a mentor outside the course can''t delete');
reset role;
select t.eq((select body from meeting_listener_notes where id = pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c1')),
  'a' || chr(160) || chr(160) || 'b', 'AC9 the refused edits changed nothing');

-- AC 10: Pending and Declined listeners can't write; they read nothing.
select pg_temp.login_id('00000000-0000-0000-0000-00000012a0f1');
select t.ok(pg_temp.add('00000000-0000-0000-0000-00000012a0c3', 'pending') <> 'no error', 'AC10 a Pending listener can''t add');
select t.ok(pg_temp.del(pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c1')) <> 'no error', 'AC10 a Pending listener can''t delete');
select t.eq((select count(*) from meeting_listener_notes), 0::bigint, 'AC10 a Pending listener reads no notes');
reset role;
select pg_temp.login_id('00000000-0000-0000-0000-00000012a0f2');
select t.ok(pg_temp.add('00000000-0000-0000-0000-00000012a0c3', 'declined') <> 'no error', 'AC10 a Declined listener can''t add');
select t.eq((select count(*) from meeting_listener_notes), 0::bigint, 'AC10 a Declined listener reads no notes');
reset role;
select t.eq((select count(*) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000012a0c3'), 0::bigint,
  'AC10 nothing was added for Pending or Declined');

-- Signed out: no update or delete.
select t.login(null);
select t.ok(pg_temp.upd(pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c1'), 'x') like '42501%',
  'AC10 signed out can''t call update');
select t.ok(pg_temp.del(pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c1')) like '42501%',
  'AC10 signed out can''t call delete');
reset role;

-- AC 7: on a hidden course, an outsider learns nothing: "Notes not found." for update and delete.
select t.login('M');
select t.eq(pg_temp.upd(pg_temp.note(t.id('S2'), '00000000-0000-0000-0000-00000012a0e1'), 'x'),
  'P0002 | Notes not found. | sham:listener_notes_not_found', 'AC7 outsider mentor updating hidden-course notes: not found');
select t.eq(pg_temp.del(pg_temp.note(t.id('S2'), '00000000-0000-0000-0000-00000012a0e1')),
  'P0002 | Notes not found. | sham:listener_notes_not_found', 'AC7 outsider mentor deleting hidden-course notes: not found');
select t.eq(pg_temp.add('00000000-0000-0000-0000-00000012a0e1', 'x'),
  'P0002 | Meeting not found. | sham:meeting_not_found', 'AC7 outsider mentor adding on a hidden course: meeting not found');
reset role;

-- An edit to more than 10,000 characters is refused, and the note stays as it was.
select t.login('S1');
select t.eq(pg_temp.upd(pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c2'), repeat('z', 10001)),
  '22001 | Notes can be at most 10,000 characters. | sham:notes_too_long', 'AC10 edit to 10,001 characters refused');
reset role;
select t.eq((select body from meeting_listener_notes where id = pg_temp.note(t.id('S1'), '00000000-0000-0000-0000-00000012a0c2')),
  'S1 on C2', 'AC10 the refused edit changed nothing');

-- AC 12: deleted accounts. S1 and M2 both had notes on C1; both accounts go.
delete from auth.users where id in (t.id('S1'), t.id('M2'));
select t.eq((select count(*) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000012a0c1' and author_id is null),
  2::bigint, 'AC12 two deleted accounts'' notes stay on one meeting, with no author');
select t.eq((select count(*) from meeting_listener_notes where author_id is null), 3::bigint,
  'AC12 every note of the deleted accounts stays');
select t.login('S3');
select t.eq(pg_temp.upd((select id from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000012a0c2' and author_id is null), 'x'),
  '42501 | Only the author can edit these notes. | sham:listener_notes_author_only', 'AC12 nobody edits a deleted account''s notes');
select t.eq(pg_temp.del((select id from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000012a0c2' and author_id is null)),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC12 another listener can''t delete a deleted account''s notes');
reset role;
-- A student outside the course, and a Pending account, can't either (ARU-135: the author check is null there).
select t.login('S2');
select t.eq(pg_temp.del(pg_temp.orphan('00000000-0000-0000-0000-00000012a0c2')),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC12 a student outside the course can''t delete a deleted account''s notes');
reset role;
select pg_temp.login_id('00000000-0000-0000-0000-00000012a0f1');
select t.ok(pg_temp.del(pg_temp.orphan('00000000-0000-0000-0000-00000012a0c2')) <> 'no error',
  'AC12 a Pending account can''t delete a deleted account''s notes');
reset role;
select t.eq((select count(*) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000012a0c2' and author_id is null),
  1::bigint, 'AC12 the deleted account''s notes are still there');
select t.login('M');
select t.eq(pg_temp.del((select id from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000012a0c2' and author_id is null)),
  'no error', 'AC12 the owner deletes a deleted account''s notes');
reset role;

-- Data: deleting a meeting, then a course, removes their notes.
delete from course_meetings where id = '00000000-0000-0000-0000-00000012a0c1';
select t.eq((select count(*) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000012a0c1'), 0::bigint,
  'data: deleting the meeting removes its notes');
delete from courses where id = '00000000-0000-0000-0000-00000012a0d1';
select t.eq((select count(*) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000012a0e1'), 0::bigint,
  'data: deleting the course removes its meetings'' notes');
