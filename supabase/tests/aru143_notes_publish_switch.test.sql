-- ARU-143: the Publish switch on meeting notes. Rules under test: supabase/migrations/0058_notes_publish_switch.sql.
-- Course A owned by mentor M: S1 (student) and M2 (mentor) are listeners; N is a mentor outside it, S2 a student
-- outside it, T the teacher. Meetings on A: c1, c2 completed.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));
create function t.m143(n text) returns uuid language sql immutable as $$ select md5('aru143' || n)::uuid $$;
grant execute on function t.m143(text) to anon, authenticated;
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.m143('c1'), t.id('A'), now() - interval '2 days', 'completed', t.id('M')),
  (t.m143('c2'), t.id('A'), now() - interval '1 day', 'completed', t.id('M'));

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

-- Data.
select t.eq((select column_default from information_schema.columns where table_name = 'meeting_listener_notes'
  and column_name = 'is_public'), 'false', 'AC1 is_public defaults to false');
select t.ok(has_function_privilege('authenticated', 'add_meeting_listener_notes(uuid, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'update_meeting_listener_notes(uuid, text, boolean)', 'execute'),
  'data: the app can run the new add / update');
select t.ok(not has_function_privilege('anon', 'add_meeting_listener_notes(uuid, text, boolean)', 'execute'),
  'data: anon cannot add');

-- AC 1: a new note is private unless published; the two-argument call makes a private one too.
select t.login('S1');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L)', t.m143('c1'), 'Sam private')), 'no error',
  'AC1 add without the flag');
select t.login('M2');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L, true)', t.m143('c1'), 'Mo public')), 'no error',
  'AC1 add published');
select t.login('T');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L, false)', t.m143('c1'), 'Tess private')), 'no error',
  'AC1 the teacher adds a private note');
reset role;
select t.ok((select not is_public from meeting_listener_notes where author_id = t.id('S1'))
  and (select is_public from meeting_listener_notes where author_id = t.id('M2'))
  and (select not is_public from meeting_listener_notes where author_id = t.id('T')), 'AC1 flags stored as sent');

-- AC 4 / 5: private only for the author; public for listeners, the owner and the teacher.
select t.login('S1');
select t.eq(pg_temp.seen(t.m143('c1')), 2::bigint, 'AC4/5 S1 reads their private and the public note');
select t.login('M2');
select t.eq(pg_temp.seen(t.m143('c1')), 1::bigint, 'AC4 M2 reads only the public note');
select t.login('M');
select t.eq(pg_temp.seen(t.m143('c1')), 1::bigint, 'AC4 the owner doesn''t read others'' private notes');
select t.login('T');
select t.eq(pg_temp.seen(t.m143('c1')), 2::bigint, 'AC4/5 the teacher reads their private and the public note');
select t.eq((select count(*) from meeting_listener_notes where author_id = t.id('S1')), 0::bigint, 'AC4 the teacher doesn''t read S1''s private note');
select t.login('N');
select t.eq(pg_temp.seen(t.m143('c1')), 0::bigint, 'AC5 a mentor outside the course reads none');
select t.login('S2');
select t.eq(pg_temp.seen(t.m143('c1')), 0::bigint, 'AC5 a student outside the course reads none');

-- AC 3: a flag-only change is not an edit; a text change is.
reset role;
-- (The trigger keeps created_at on update, so only updated_at is moved back an hour.)
update meeting_listener_notes set updated_at = now() - interval '1 hour';
select t.login('S1');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, true)', pg_temp.note('S1', t.m143('c1')), 'Sam private')),
  'no error', 'AC3 publish without changing the text');
reset role;
select t.ok((select is_public and updated_at < now() - interval '59 minutes' from meeting_listener_notes where author_id = t.id('S1')),
  'AC3 published, updated_at unchanged (no "Edited")');
select t.login('M');
select t.eq(pg_temp.seen(t.m143('c1')), 2::bigint, 'AC5 the owner now reads S1''s published note');
select t.login('S1');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L)', pg_temp.note('S1', t.m143('c1')), 'Sam edited')),
  'no error', 'AC3 edit the text with the two-argument call');
reset role;
select t.ok((select is_public and updated_at > now() - interval '1 minute' and body = 'Sam edited' from meeting_listener_notes where author_id = t.id('S1')),
  'AC3 the flag is kept and the text change shows "Edited"');
select t.login('S1');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, false)', pg_temp.note('S1', t.m143('c1')), 'Sam edited')),
  'no error', 'AC3 make it private again');
select t.login('M');
select t.eq(pg_temp.seen(t.m143('c1')), 1::bigint, 'AC10 once private, the owner no longer reads it');

-- Edge: a note over 10,000 characters (from ARU-142's migration) can't change only its flag.
reset role;
update meeting_listener_notes set body = repeat('a', 10001) where author_id = t.id('M2');
select t.login('M2');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, false)', pg_temp.note('M2', t.m143('c1')), repeat('a', 10001))),
  '22001 | Notes can be at most 10,000 characters. | sham:notes_too_long', 'edge: an over-limit note must be shortened first');
reset role;
select t.ok((select is_public from meeting_listener_notes where author_id = t.id('M2')), 'edge: its flag didn''t change');
update meeting_listener_notes set body = 'Mo public' where author_id = t.id('M2');

-- AC 8: private notes only by their author; public ones also by the owner and the teacher.
select t.login('M');
select t.eq(pg_temp.err(format('select delete_meeting_listener_notes(%L)', pg_temp.note('S1', t.m143('c1')))),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC8 the owner can''t delete a private note');
select t.login('T');
select t.eq(pg_temp.err(format('select delete_meeting_listener_notes(%L)', pg_temp.note('S1', t.m143('c1')))),
  '42501 | You can''t delete these notes. | sham:listener_notes_cant_delete', 'AC8 the teacher can''t delete a private note');
select t.login('M');
select t.eq(pg_temp.err(format('select delete_meeting_listener_notes(%L)', pg_temp.note('M2', t.m143('c1')))), 'no error',
  'AC8 the owner deletes a public note');
select t.login('S1');
select t.eq(pg_temp.err(format('select delete_meeting_listener_notes(%L)', pg_temp.note('S1', t.m143('c1')))), 'no error',
  'AC8 the author deletes their private note');
reset role;
select t.eq((select count(*) from meeting_listener_notes where meeting_id = t.m143('c1')), 1::bigint, 'AC8 only the teacher''s note is left');

-- Edge: a change of owner. The former owner keeps reading and deleting their own private note, but can't edit it.
select t.login('M');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L)', t.m143('c2'), 'Max private')), 'no error', 'M adds a private note on c2');
reset role;
update courses set created_by = t.id('N') where id = t.id('A');
select t.login('M');
select t.eq(pg_temp.seen(t.m143('c2')), 1::bigint, 'edge: the former owner reads their own private note');
select t.eq(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, true)', pg_temp.note('M', t.m143('c2')), 'Max private')),
  '42501 | Only the course''s listeners, its owner and the teacher can edit notes. | sham:notes_edit_role',
  'edge: the former owner can''t publish it');
select t.login('N');
select t.eq(pg_temp.seen(t.m143('c2')), 0::bigint, 'edge: the new owner doesn''t read it');
select t.login('M');
select t.eq(pg_temp.err(format('select delete_meeting_listener_notes(%L)', pg_temp.note('M', t.m143('c2')))), 'no error',
  'edge: the former owner deletes their private note');

-- A Pending account reads nothing, its own notes included (ARU-43).
reset role;
select t.login('S1');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L)', t.m143('c2'), 'Sam private c2')), 'no error', 'S1 adds a private note on c2');
reset role;
update profiles set access_status = 'pending' where id = t.id('S1');
select t.login('S1');
select t.eq((select count(*) from meeting_listener_notes), 0::bigint, 'a Pending account reads none of its notes');
reset role;
update profiles set access_status = 'approved' where id = t.id('S1');

-- AC 9: deleting an account deletes its private notes; its public ones stay with no author.
select t.login('S1');
select t.eq(pg_temp.err(format('select add_meeting_listener_notes(%L, %L, true)', t.m143('c1'), 'Sam public c1')), 'no error', 'S1 adds a public note on c1');
reset role;
delete from auth.users where id = t.id('S1');
select t.eq((select count(*) from meeting_listener_notes where body = 'Sam private c2'), 0::bigint, 'AC9 the private note is deleted');
select t.eq((select count(*) from meeting_listener_notes where body = 'Sam public c1' and author_id is null), 1::bigint,
  'AC9 the public note stays, as "Deleted account"');
select t.login('T');
select t.eq(pg_temp.err(format('select delete_meeting_listener_notes(%L)', (select id from meeting_listener_notes where body = 'Sam public c1'))),
  'no error', 'AC8 the teacher deletes a deleted account''s public note');
reset role;
