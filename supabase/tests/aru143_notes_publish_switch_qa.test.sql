-- QA ARU-143: gaps in aru143_notes_publish_switch.test.sql (rules: 0058_notes_publish_switch.sql):
-- - AC 4 in a hidden course: a listener's private note is read only by them; the teacher and the owner don't.
-- - AC 4: a mentor listener's private note isn't read by the owner, the teacher or another listener.
-- - AC 3: only the author changes the flag (the owner and the teacher are refused, on public and private notes);
--   a null flag keeps it; same text and flag is a no-op (updated_at stays).
-- - Direct table writes stay revoked: no one flips is_public (or anything else) without the functions.
-- - Edge: a removed listener's private note stays unseen by the course; when re-added they edit it again.
-- - AC 8: a Pending author can't delete their own private note; a listener can't delete a deleted account's note.
-- - AC 9: an account deletion refused (an owner of courses) keeps that account's private notes.
-- Course A owned by mentor M: S1 (student) and M2 (mentor) are listeners. Hidden course H owned by N: S2 listener.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));
create function t.q143(n text) returns uuid language sql immutable as $$ select md5('aru143qa' || n)::uuid $$;
grant execute on function t.q143(text) to anon, authenticated;
insert into courses (id, title, created_by, hidden) values (t.q143('H'), 'Hidden lab', t.id('N'), true);
insert into course_members (course_id, user_id, added_by) values (t.q143('H'), t.id('S2'), t.id('N'));
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.q143('a1'), t.id('A'), now() - interval '2 days', 'completed', t.id('M')),
  (t.q143('h1'), t.q143('H'), now() - interval '2 days', 'completed', t.id('N'));

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; msg text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, msg = message_text, hint = pg_exception_hint;
  return concat_ws(' | ', code, msg, hint);
end $$;
create function pg_temp.note(who text, meeting uuid) returns uuid language sql security definer as $$
  select id from public.meeting_listener_notes where author_id = t.id(who) and meeting_id = meeting $$;
create function pg_temp.seen(meeting uuid) returns bigint language sql as $$
  select count(*) from public.meeting_listener_notes where meeting_id = meeting $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- AC 4 in a hidden course.
select t.login('S2');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L, false)', t.q143('h1'), 'S2 private')), 'no error',
  'hidden: the listener adds a private note');
select t.eq(pg_temp.seen(t.q143('h1')), 1::bigint, 'AC4 hidden: the author reads it');
select t.login('N');
select t.eq(pg_temp.seen(t.q143('h1')), 0::bigint, 'AC4 hidden: the owner doesn''t read it');
select t.login('T');
select t.eq(pg_temp.seen(t.q143('h1')), 0::bigint, 'AC4 hidden: the teacher doesn''t read it');
select t.login('S2');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, true)', pg_temp.note('S2', t.q143('h1')), 'S2 private')),
  'no error', 'hidden: the author publishes it');
select t.login('N');
select t.eq(pg_temp.seen(t.q143('h1')), 1::bigint, 'AC5 hidden: now the owner reads it');
select t.login('M');
select t.eq(pg_temp.seen(t.q143('h1')), 0::bigint, 'AC5 hidden: a mentor outside the hidden course still reads none');

-- AC 4: a mentor listener's private note.
select t.login('M2');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L)', t.q143('a1'), 'Mo private')), 'no error',
  'M2 adds a note with no flag');
reset role;
select t.ok((select not is_public from meeting_listener_notes where author_id = t.id('M2')), 'AC1 no flag means private');
select t.login('M');
select t.eq(pg_temp.seen(t.q143('a1')), 0::bigint, 'AC4 the owner doesn''t read a mentor listener''s private note');
select t.login('T');
select t.eq(pg_temp.seen(t.q143('a1')), 0::bigint, 'AC4 the teacher doesn''t read it');
select t.login('S1');
select t.eq(pg_temp.seen(t.q143('a1')), 0::bigint, 'AC4 another listener doesn''t read it');

-- AC 3: only the author changes the flag.
select t.login('M');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, true)', pg_temp.note('M2', t.q143('a1')), 'Mo private')),
  '42501 | Only the author can edit these notes. | sham:listener_notes_author_only', 'AC3 the owner can''t publish someone''s note');
select t.login('M2');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, true)', pg_temp.note('M2', t.q143('a1')), 'Mo private')),
  'no error', 'M2 publishes it');
select t.login('T');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, false)', pg_temp.note('M2', t.q143('a1')), 'Mo private')),
  '42501 | Only the author can edit these notes. | sham:listener_notes_author_only', 'AC3 the teacher can''t make someone''s note private');
reset role;
update meeting_listener_notes set updated_at = now() - interval '1 hour' where author_id = t.id('M2');
select t.login('M2');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, null)', pg_temp.note('M2', t.q143('a1')), 'Mo private')),
  'no error', 'AC3 a null flag with the same text');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, true)', pg_temp.note('M2', t.q143('a1')), 'Mo private')),
  'no error', 'AC3 the same text and flag');
reset role;
select t.ok((select is_public and updated_at < now() - interval '59 minutes' from meeting_listener_notes where author_id = t.id('M2')),
  'AC3 both are no-ops: still public, updated_at unchanged');

-- Direct writes stay revoked, so the flag only changes through the functions.
select t.login('M2');
select t.throws(format('update meeting_listener_notes set is_public = false where id = %L', pg_temp.note('M2', t.q143('a1'))),
  '42501', 'direct: the author can''t flip is_public on the table');
select t.throws(format('insert into meeting_listener_notes (meeting_id, author_id, body, is_public) values (%L, %L, %L, true)',
  t.q143('a1'), t.id('M2'), 'direct'), '42501', 'direct: no insert');
select t.login('M');
select t.throws(format('delete from meeting_listener_notes where id = %L', pg_temp.note('M2', t.q143('a1'))),
  '42501', 'direct: no delete');
reset role;

-- Edge: a removed listener's private note stays unseen; re-added, they edit it again.
select t.login('S1');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L, false)', t.q143('a1'), 'Sam private')), 'no error',
  'S1 adds a private note');
reset role;
delete from course_members where course_id = t.id('A') and user_id = t.id('S1');
select t.login('M');
select t.eq((select count(*) from meeting_listener_notes where author_id = t.id('S1')), 0::bigint,
  'edge: the removed listener''s private note stays unseen by the owner');
select t.login('S1');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, true)', pg_temp.note('S1', t.q143('a1')), 'Sam private')),
  '42501 | Only the course''s listeners, its owner and the teacher can edit notes. | sham:notes_edit_role',
  'edge: while removed, they can''t publish it');
reset role;
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
select t.login('S1');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, true)', pg_temp.note('S1', t.q143('a1')), 'Sam private')),
  'no error', 'edge: re-added, they publish it');

-- AC 8: a Pending author can't delete; a listener can't delete a deleted account's public note.
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, false)', pg_temp.note('S1', t.q143('a1')), 'Sam private')),
  'no error', 'S1 makes it private again');
reset role;
update profiles set access_status = 'pending' where id = t.id('S1');
select t.login('S1');
select t.eq(pg_temp.err(format('select delete_meeting_listener_notes(%L)', pg_temp.note('S1', t.q143('a1')))),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC8 a Pending author can''t delete their private note');
reset role;
update profiles set access_status = 'approved' where id = t.id('S1');
create table pg_temp.gone as select id from meeting_listener_notes where author_id = t.id('M2');
update meeting_listener_notes set author_id = null where author_id = t.id('M2');
grant select on pg_temp.gone to authenticated;
select t.login('S1');
select t.eq(pg_temp.err(format('select delete_meeting_listener_notes(%L)', (select id from pg_temp.gone))),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC8 a listener can''t delete a deleted account''s note');

-- AC 9: a refused account deletion keeps the account's private notes.
select t.login('M');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L, false)', t.q143('a1'), 'Max private')), 'no error',
  'the owner adds a private note');
reset role;
select t.ok(pg_temp.err(format('delete from auth.users where id = %L', t.id('M'))) like 'P0001 | You own courses:%',
  'AC9 deleting an owner of courses is refused');
select t.eq((select count(*) from meeting_listener_notes where body = 'Max private'), 1::bigint,
  'AC9 a refused deletion keeps the private note');
