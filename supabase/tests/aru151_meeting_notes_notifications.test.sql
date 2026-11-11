-- ARU-151: meeting_notes_recipients(), the Meeting notes switch, the `announced` flag and the triggers on
-- meeting_listener_notes that queue the pg_net call. Rules under test: supabase/migrations/0062_meeting_notes_notifications.sql.
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2; students S1, S2, S3. Here: course A has listeners
-- S1 and M2, and the Pending account P and the Rejected account R; N and S2 are outside it. A second workspace W2 has
-- its own teacher XT. Everyone but S3 has a Telegram link (all switches on). Meetings on A: c1, c2, c3 completed.
select t.seed();
create function t.mid(name text) returns uuid language sql immutable as $$ select md5('aru151-' || name)::uuid $$;
grant execute on function t.mid(text) to anon, authenticated, service_role;
create function t.u(name text) returns uuid language sql immutable as $$ select coalesce(t.id(name), t.mid(name)) $$;
grant execute on function t.u(text) to anon, authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  (t.u('P'), 'p151@x.test', '{"full_name":"Pending Pat"}'),
  (t.u('R'), 'r151@x.test', '{"full_name":"Rejected Ray"}'),
  (t.u('XT'), 'xt151@x.test', '{"full_name":"Xena Teacher"}');
insert into workspaces (id, name, created_at) values (t.u('W2'), 'Other school', now());
set session_replication_role = replica;
update profiles set access_status = 'pending' where id = t.u('P');
update profiles set access_status = 'rejected' where id = t.u('R');
update profiles set workspace_id = t.u('W2'), access_status = 'approved', role = 'teacher' where id = t.u('XT');
set session_replication_role = origin;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.u('P'), t.id('M')),
  (t.id('A'), t.u('R'), t.id('M'));
insert into telegram_links (user_id, chat_id) values
  (t.id('T'), 5001), (t.id('M'), 5002), (t.id('N'), 5003), (t.id('M2'), 5004),
  (t.id('S1'), 5005), (t.id('S2'), 5006), (t.u('P'), 5007), (t.u('R'), 5008);
set session_replication_role = replica;
insert into telegram_links (user_id, chat_id, workspace_id) values (t.u('XT'), 5009, t.u('W2'));
set session_replication_role = origin;
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.mid('c1'), t.id('A'), now() - interval '3 days', 'completed', t.id('M')),
  (t.mid('c2'), t.id('A'), now() - interval '2 days', 'completed', t.id('M')),
  (t.mid('c3'), t.id('A'), now() - interval '1 day', 'completed', t.id('M'));
insert into vault.decrypted_secrets (name, decrypted_secret) values
  ('meeting_notes_notify_url', 'https://x.supabase.co/functions/v1/meeting-notes-notifications'),
  ('meeting_notes_notify_secret', 's3cret');

grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- The caller's note on a meeting (security definer: the caller may not be able to read it).
create function t.note(who text, meeting text) returns uuid language sql security definer as $$
  select id from public.meeting_listener_notes where author_id = t.id(who) and meeting_id = t.mid(meeting) $$;
grant execute on function t.note(text, text) to anon, authenticated, service_role;
create function t.add(meeting text, body text, publish boolean) returns text language sql as $$
  select format('select add_meeting_listener_notes(%L, %L, %L)', t.mid(meeting), body, publish) $$;
create function t.upd(who text, meeting text, body text, publish boolean) returns text language sql as $$
  select format('select update_meeting_listener_notes(%L, %L, %L)', t.note(who, meeting), body, publish) $$;
grant execute on function t.add(text, text, boolean) to authenticated;
grant execute on function t.upd(text, text, text, boolean) to authenticated;

-- "<author>|<course>: <recipients, sorted>" or '' when nobody gets it. Called as the service role.
create function t.recipients(note uuid) returns text language plpgsql as $$
declare
  result text;
  names text[] := array['T','M','N','M2','S1','S2','S3','P','R','XT'];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select coalesce(min(r.author_name) || '|' || min(r.course_title) || ': ' || string_agg(coalesce(
           (select k from unnest(names) k where t.u(k) = r.user_id), '?'),
           ',' order by (select k from unnest(names) k where t.u(k) = r.user_id)), '')
    into result from meeting_notes_recipients(note) r;
  reset role;
  return result;
end $$;
grant execute on function t.recipients(uuid) to service_role;

create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant execute on function t.calls() to anon, authenticated, service_role;
create function t.last_body() returns jsonb language sql security definer as $$
  select body from net.requests order by id desc limit 1 $$;
grant execute on function t.last_body() to anon, authenticated, service_role;

-- Data: columns, grants, triggers.
select t.ok((select bool_and(notify_meeting_notes) from telegram_links), 'AC7 on by default for existing links');
select t.eq((select column_default from information_schema.columns where table_name = 'meeting_listener_notes'
  and column_name = 'announced'), 'false', 'data: announced defaults to false');
select t.ok(not has_function_privilege('anon', 'meeting_notes_recipients(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'meeting_notes_recipients(uuid)', 'execute')
  and has_function_privilege('service_role', 'meeting_notes_recipients(uuid)', 'execute'),
  'AC11 only the service role runs meeting_notes_recipients');
select t.ok(not has_function_privilege('authenticated', 'queue_meeting_notes_notification(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'notify_meeting_notes_published()', 'execute')
  and not has_function_privilege('authenticated', 'meeting_listener_notes_announce()', 'execute')
  and not has_function_privilege('anon', 'queue_meeting_notes_notification(uuid)', 'execute'),
  'AC11 the trigger functions can''t be called by app users');
select t.ok((select prosecdef from pg_proc where proname = 'meeting_notes_recipients'), 'data: recipients is security definer');
select t.login('S1');
select t.throws(format('select * from meeting_notes_recipients(%L)', t.mid('x')), '42501', 'AC11 authenticated can''t call it');
reset role;
select t.login(null);
select t.throws(format('select * from meeting_notes_recipients(%L)', t.mid('x')), '42501', 'AC11 anon can''t call it');
reset role;

-- AC 7: the switch.
select t.login('S1');
select t.lives('select set_telegram_notification(''meeting_notes'', false)', 'AC7 a student turns it off');
reset role;
select t.ok(not (select notify_meeting_notes from telegram_links where user_id = t.id('S1')), 'AC7 saved off');
select t.ok((select notify_meeting_notes from telegram_links where user_id = t.id('M2')), 'AC7 only the caller''s row');
select t.ok((select notify_new_material and notify_general_chat and notify_photo_deletion and notify_chat_message
  from telegram_links where user_id = t.id('S1')), 'AC7 other switches untouched');
select t.login('S1');
select t.lives('select set_telegram_notification(''meeting_notes'', true)', 'AC7 back on');
select t.lives('select set_telegram_notification(''photo_deletion'', true)', 'ARU-112 kind still works');
select t.lives('select set_telegram_notification(''new_material'', true)', 'ARU-102 kind still works');
select t.lives('select set_telegram_notification(''general_chat'', true)', 'ARU-87 kind still works');
select t.lives('select set_telegram_notification(''homework_submitted'', true)', 'ARU-89 kind still works');
select t.lives('select set_telegram_notification(''new_account'', true)', 'ARU-84 kind still works');
select t.lives('select set_telegram_notification(''meeting_started'', true)', 'ARU-48 kind still works');
select t.throws('select set_telegram_notification(''nope'', true)', '22023', 'an unknown kind is still refused');
reset role;

-- AC 1 / AC 10: a note saved with Publish on queues one call {"id": <note>} with the secret.
select t.login('S1');
select t.lives(t.add('c1', 'Sam public', true), 'AC1 S1 adds published notes');
reset role;
select t.eq(t.calls(), 1::bigint, 'AC1 one call queued');
select t.eq(t.last_body(), jsonb_build_object('id', t.note('S1', 'c1')), 'AC10 the body is the note id');
select t.eq((select headers->>'Authorization' from net.requests order by id desc limit 1), 'Bearer s3cret',
  'AC10 the secret in the header');
select t.eq((select url from net.requests order by id desc limit 1),
  'https://x.supabase.co/functions/v1/meeting-notes-notifications', 'AC10 the Vault URL');
select t.eq((select timeout_milliseconds from net.requests order by id desc limit 1), 5000, 'AC10 an explicit timeout');
select t.ok((select announced from meeting_listener_notes where id = t.note('S1', 'c1')), 'AC3 the note is announced');

-- Recipients (AC 1, 4, 5): listeners, the owner and the teacher; not the author, outsiders, Pending, Rejected or W2.
select t.eq(t.recipients(t.note('S1', 'c1')), 'Student Sam|Algebra: M,M2,T', 'AC1/4/5 recipients of S1''s note');

-- AC 1: the owner and the teacher as authors.
select t.login('M');
select t.lives(t.add('c1', 'Owner public', true), 'AC1 the owner publishes');
select t.login('T');
select t.lives(t.add('c1', 'Teacher public', true), 'AC1 the teacher publishes');
reset role;
select t.eq(t.calls(), 3::bigint, 'AC1 one call each');
select t.eq(t.recipients(t.note('M', 'c1')), 'Mentor Max|Algebra: M2,S1,T', 'AC5 the owner''s note: not the owner');
select t.eq(t.recipients(t.note('T', 'c1')), 'Teacher Tess|Algebra: M,M2,S1', 'AC5 the teacher''s note: not the teacher');

-- AC 2 / AC 3: private when added → nothing; published later → one call; edits and re-publishing → nothing.
select t.login('M2');
select t.lives(t.add('c1', 'Mo private', false), 'AC3 a private note');
reset role;
select t.eq(t.calls(), 3::bigint, 'AC3 saved private: no call');
select t.eq(t.recipients(t.note('M2', 'c1')), '', 'AC4 a private note has no recipients');
select t.ok(not (select announced from meeting_listener_notes where id = t.note('M2', 'c1')), 'AC3 not announced yet');
select t.login('M2');
select t.lives(t.upd('M2', 'c1', 'Mo private edited', null), 'AC3 a private note edited');
reset role;
select t.eq(t.calls(), 3::bigint, 'AC3 private edit: no call');
create temp table before_publish as
  select updated_at from meeting_listener_notes where id = t.note('M2', 'c1');
select t.login('M2');
select t.lives(t.upd('M2', 'c1', 'Mo private edited', true), 'AC2 published later (flag only)');
reset role;
select t.eq(t.calls(), 4::bigint, 'AC2 published later: one call');
select t.eq(t.last_body(), jsonb_build_object('id', t.note('M2', 'c1')), 'AC2 for that note');
select t.eq(t.recipients(t.note('M2', 'c1')), 'Mentor Mo|Algebra: M,S1,T', 'AC2 recipients');
select t.eq((select updated_at from meeting_listener_notes where id = t.note('M2', 'c1')),
  (select updated_at from before_publish), 'data: announcing never changes updated_at (no "Edited")');
select t.login('M2');
select t.lives(t.upd('M2', 'c1', 'Mo public edited', null), 'AC3 text edit of a public note');
select t.lives(t.upd('M2', 'c1', 'Mo public edited', false), 'AC3 made private');
reset role;
select t.eq(t.calls(), 4::bigint, 'AC3 edit and made private: no call');
select t.ok((select announced from meeting_listener_notes where id = t.note('M2', 'c1')), 'AC3 stays announced when private');
select t.eq(t.recipients(t.note('M2', 'c1')), '', 'AC4 private at processing time: nobody');
select t.login('M2');
select t.lives(t.upd('M2', 'c1', 'Mo public edited', true), 'AC3 public again');
reset role;
select t.eq(t.calls(), 4::bigint, 'AC3 public → private → public: no second call');

-- AC 3: the flag is the database's; whatever a writer sends is overridden.
update meeting_listener_notes set announced = false where id = t.note('M2', 'c1');
select t.ok((select announced from meeting_listener_notes where id = t.note('M2', 'c1')), 'AC3 announced can''t be cleared');
select t.eq(t.calls(), 4::bigint, 'AC3 nor does trying queue a call');
insert into meeting_listener_notes (meeting_id, author_id, body, is_public, announced)
  values (t.mid('c2'), t.id('S1'), 'Forged', false, true);
select t.ok(not (select announced from meeting_listener_notes where id = t.note('S1', 'c2')),
  'AC3 a private insert is never announced');
select t.eq(t.calls(), 4::bigint, 'AC3 and queues nothing');
delete from meeting_listener_notes where id = t.note('S1', 'c2');

-- AC 7: the switch off → left out (the lookup is at processing time).
update telegram_links set notify_meeting_notes = false where user_id = t.id('M');
select t.eq(t.recipients(t.note('S1', 'c1')), 'Student Sam|Algebra: M2,T', 'AC7 switch off: left out');
update telegram_links set notify_meeting_notes = true where user_id = t.id('M');
delete from telegram_links where user_id = t.id('M2');
select t.eq(t.recipients(t.note('S1', 'c1')), 'Student Sam|Algebra: M,T', 'AC7 not linked: left out');
insert into telegram_links (user_id, chat_id) values (t.id('M2'), 5004);

-- Edge: a hidden course is never hidden from its listeners, owner or teacher.
update courses set hidden = true where id = t.id('A');
select t.eq(t.recipients(t.note('S1', 'c1')), 'Student Sam|Algebra: M,M2,T', 'edge: hidden course, same recipients');
update courses set hidden = false where id = t.id('A');

-- Edge: a listener removed before processing → left out; renamed author and course → current values, as typed.
delete from course_members where course_id = t.id('A') and user_id = t.id('M2');
select t.eq(t.recipients(t.note('S1', 'c1')), 'Student Sam|Algebra: M,T', 'edge: removed listener left out');
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('M2'), t.id('M'));
update profiles set full_name = 'Sam *B* <i>' where id = t.id('S1');
update courses set title = 'Alg_ebra 😀' where id = t.id('A');
select t.eq(t.recipients(t.note('S1', 'c1')), 'Sam *B* <i>|Alg_ebra 😀: M,M2,T', 'edge: current names, as typed');
update profiles set full_name = 'Student Sam' where id = t.id('S1');
update courses set title = 'Algebra' where id = t.id('A');

-- AC 6: deleted note, unknown id, author gone → nothing.
create temp table deleted_note as select t.note('M2', 'c1') as id;
grant select on deleted_note to authenticated, service_role;
select t.login('M2');
select t.lives(format('select delete_meeting_listener_notes(%L)', (select id from deleted_note)), 'AC6 a note deleted');
reset role;
select t.eq(t.calls(), 4::bigint, 'AC6 deleting queues nothing');
select t.eq(t.recipients((select id from deleted_note)), '', 'AC6 deleted note: nothing');
select t.eq(t.recipients(t.mid('gone')), '', 'AC6 unknown id: nothing');
update meeting_listener_notes set author_id = null where id = t.note('T', 'c1');
select t.eq(t.recipients((select id from meeting_listener_notes where author_id is null and body = 'Teacher public')), '',
  'AC6 author gone: nothing');
select t.eq(t.calls(), 4::bigint, 'AC6 the author becoming null queues nothing');

-- AC 9: no Vault secret → saved, no call; net.http_post raising → saved; no pg_net → saved.
delete from vault.decrypted_secrets where name = 'meeting_notes_notify_secret';
select t.login('S1');
select t.lives(t.add('c2', 'No secret', true), 'AC9 no secret: still saved');
reset role;
select t.eq(t.calls(), 4::bigint, 'AC9 no secret: no call');
select t.ok((select announced and is_public from meeting_listener_notes where id = t.note('S1', 'c2')),
  'AC9 the note is saved public (and counts as announced)');
insert into vault.decrypted_secrets (name, decrypted_secret) values ('meeting_notes_notify_secret', 's3cret');
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language plpgsql as $$ begin raise exception 'pg_net is down'; end $$;
select t.login('M');
select t.lives(t.add('c2', 'Still saved', true), 'AC9 http_post raising: still saved');
reset role;
select t.ok(exists (select 1 from meeting_listener_notes where id = t.note('M', 'c2')), 'AC9 the row exists');
drop function net.http_post(text, jsonb, jsonb, jsonb, integer);
select t.login('M2');
select t.lives(t.add('c3', 'No pg_net', true), 'AC9 no pg_net: still saved');
reset role;
select t.ok(exists (select 1 from meeting_listener_notes where id = t.note('M2', 'c3')), 'AC9 the row exists');

-- AC 8: the migration's fill marks every public note announced and no private one (replayed on this data).
update meeting_listener_notes set announced = false;
alter table meeting_listener_notes disable trigger user;
update meeting_listener_notes set announced = false;
update meeting_listener_notes set announced = true where is_public;
alter table meeting_listener_notes enable trigger user;
select t.ok((select bool_and(announced = is_public) from meeting_listener_notes), 'AC8 public notes count as announced');

select t.ok(not exists (select 1 from pg_policies where tablename = 'meeting_listener_notes'
  and policyname ilike '%announce%'), 'no new RLS policy');
