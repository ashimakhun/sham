-- QA ARU-151: gaps in aru151_meeting_notes_notifications.test.sql:
--   * function settings: every new function is security definer with search_path=public; the triggers are row-level,
--     BEFORE (announce) / AFTER (notify) insert or update only, never on delete;
--   * privacy: every queued body is exactly {"id": ...}, with no note text, author or course;
--   * a multi-row insert queues one call per public row, each with its own id, none for the private one;
--   * the owner who is also listed as a listener is returned once;
--   * the owner changed before processing: the new owner is in, the old one out (and the author never);
--   * a teacher of another workspace is never a recipient and the W1 teacher never gets a W2 note;
--   * a Pending account approved later is a recipient; an approved one declined later is not;
--   * the author's account really deleted (auth.users): the private note goes, the public one stays authorless,
--     nothing is queued and nobody is returned;
--   * a rejected publish (notes too long) rolls back: not announced, no call; the next valid publish announces once;
--   * an empty Vault URL queues nothing;
--   * set_telegram_notification: signed out is refused, a null value keeps its sham: hint, the new kind and an older
--     one save.
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2; students S1, S2, S3.
select t.seed();
create function t.mid(name text) returns uuid language sql immutable as $$ select md5('aru151qa-' || name)::uuid $$;
create function t.u(name text) returns uuid language sql immutable as $$ select coalesce(t.id(name), t.mid(name)) $$;
grant usage on schema t to service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  (t.u('P'), 'p151qa@x.test', '{"full_name":"Pending Pat"}'),
  (t.u('L'), 'l151qa@x.test', '{"full_name":"Leaving Lee"}'),
  (t.u('XT'), 'xt151qa@x.test', '{"full_name":"Xena Teacher"}'),
  (t.u('XS'), 'xs151qa@x.test', '{"full_name":"Xavi Student"}');
insert into workspaces (id, name, created_at) values (t.u('W2'), 'Other school', now());
set session_replication_role = replica;
update profiles set access_status = 'pending' where id = t.u('P');
update profiles set access_status = 'approved' where id = t.u('L');
update profiles set workspace_id = t.u('W2'), access_status = 'approved', role = 'teacher' where id = t.u('XT');
update profiles set workspace_id = t.u('W2'), access_status = 'approved', role = 'student' where id = t.u('XS');
set session_replication_role = origin;

-- Course A (owner M): listeners S1, M2, P, L, and M itself (data from before the ARU-9 rules).
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.u('P'), t.id('M')),
  (t.id('A'), t.u('L'), t.id('M')),
  (t.id('A'), t.id('M'), t.id('M'));
insert into telegram_links (user_id, chat_id) values
  (t.id('T'), 6001), (t.id('M'), 6002), (t.id('N'), 6003), (t.id('M2'), 6004),
  (t.id('S1'), 6005), (t.id('S2'), 6006), (t.u('P'), 6007), (t.u('L'), 6008);
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.mid('c1'), t.id('A'), now() - interval '3 days', 'completed', t.id('M')),
  (t.mid('c2'), t.id('A'), now() - interval '2 days', 'completed', t.id('M')),
  (t.mid('c3'), t.id('A'), now() - interval '1 day', 'completed', t.id('M'));

-- Workspace W2: course X (owner XT, teacher of W2), listener XS, one completed meeting, a public note by XS. Inserted
-- without triggers, with explicit workspaces.
set session_replication_role = replica;
insert into telegram_links (user_id, chat_id, workspace_id) values (t.u('XT'), 6009, t.u('W2')), (t.u('XS'), 6010, t.u('W2'));
insert into courses (id, title, created_by, workspace_id) values (t.u('X'), 'Xylophone', t.u('XT'), t.u('W2'));
insert into course_members (course_id, user_id, added_by, workspace_id) values (t.u('X'), t.u('XS'), t.u('XT'), t.u('W2'));
insert into course_meetings (id, course_id, starts_at, status, created_by, workspace_id)
  values (t.mid('x1'), t.u('X'), now() - interval '1 day', 'completed', t.u('XT'), t.u('W2'));
insert into meeting_listener_notes (id, meeting_id, course_id, author_id, body, is_public, announced, workspace_id)
  values (t.mid('xn'), t.mid('x1'), t.u('X'), t.u('XS'), 'W2 note', true, true, t.u('W2'));
set session_replication_role = origin;

insert into vault.decrypted_secrets (name, decrypted_secret) values
  ('meeting_notes_notify_url', 'https://x.supabase.co/functions/v1/meeting-notes-notifications'),
  ('meeting_notes_notify_secret', 's3cret');

create function t.note(who text, meeting text) returns uuid language sql security definer as $$
  select id from public.meeting_listener_notes where author_id = t.u(who) and meeting_id = t.mid(meeting) $$;
create function t.add(meeting text, body text, publish boolean) returns text language sql as $$
  select format('select add_meeting_listener_notes(%L, %L, %L)', t.mid(meeting), body, publish) $$;
create function t.upd(who text, meeting text, body text, publish boolean) returns text language sql as $$
  select format('select update_meeting_listener_notes(%L, %L, %L)', t.note(who, meeting), body, publish) $$;
create function t.recipients(note uuid) returns text language plpgsql as $$
declare
  result text;
  names text[] := array['T','M','N','M2','S1','S2','S3','P','L','XT','XS'];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select coalesce(string_agg(coalesce((select k from unnest(names) k where t.u(k) = r.user_id), '?'),
           ',' order by (select k from unnest(names) k where t.u(k) = r.user_id)), '')
    into result from meeting_notes_recipients(note) r;
  reset role;
  return result;
end $$;
create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
-- t.login() only knows the fixture names; this one also signs in the accounts made here.
create function t.as(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.u(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
-- The sham: hint raised by a statement run as the given user ('' when it doesn't fail).
create function t.hint(who text, stmt text) returns text language plpgsql as $$
declare h text := '';
begin
  perform t.login(who);
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
  end;
  reset role;
  return coalesce(h, '');
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- Function settings and trigger shape.
select t.ok((select bool_and(prosecdef and proconfig @> array['search_path=public']) from pg_proc
  where proname in ('meeting_notes_recipients', 'meeting_listener_notes_announce', 'queue_meeting_notes_notification',
                    'notify_meeting_notes_published', 'set_telegram_notification')
  and pronamespace = 'public'::regnamespace), 'all new functions: security definer, search_path=public');
select t.eq((select count(*) from pg_proc where proname in ('meeting_notes_recipients', 'meeting_listener_notes_announce',
  'queue_meeting_notes_notification', 'notify_meeting_notes_published') and pronamespace = 'public'::regnamespace),
  4::bigint, 'exactly one version of each new function');
-- tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update.
select t.eq((select tgtype & 31 from pg_trigger where tgname = 'meeting_listener_notes_announce'), 1 + 2 + 4 + 16,
  'announce: row-level BEFORE insert or update, not delete');
select t.eq((select tgtype & 31 from pg_trigger where tgname = 'meeting_listener_notes_notify'), 1 + 4 + 16,
  'notify: row-level AFTER insert or update, not delete');
select t.ok(not has_function_privilege('anon', 'meeting_listener_notes_announce()', 'execute')
  and not has_function_privilege('anon', 'notify_meeting_notes_published()', 'execute'),
  'anon can''t run the trigger functions');

-- set_telegram_notification keeps the ARU-111 hints for the new kind.
select t.login(null);
select t.throws('select set_telegram_notification(''meeting_notes'', false)', '42501', 'signed out: refused');
reset role;
select t.eq(t.hint('S1', 'select set_telegram_notification(''meeting_notes'', null)'), 'sham:choose_on_off',
  'null: sham:choose_on_off');
select t.eq(t.hint('S1', 'select set_telegram_notification(''meeting_notes'', true)'), '', 'meeting_notes saves');
select t.eq(t.hint('S1', 'select set_telegram_notification(''photo_deletion'', true)'), '', 'photo_deletion still saves');

-- The owner also listed as a listener: returned once. P is Pending: left out.
select t.login('S1');
select t.lives(t.add('c1', 'Sam on c1', true), 'S1 publishes on c1');
reset role;
select t.eq(t.calls(), 1::bigint, 'one call');
select t.eq(t.recipients(t.note('S1', 'c1')), 'L,M,M2,T', 'owner-and-listener once; Pending P, outsiders, W2 out');

-- Pending approved later: in. Approved declined later: out (recipients are computed at processing time).
update profiles set access_status = 'approved' where id = t.u('P');
update profiles set access_status = 'rejected' where id = t.u('L');
select t.eq(t.recipients(t.note('S1', 'c1')), 'M,M2,P,T', 'approved later in, declined later out');
update profiles set access_status = 'pending' where id = t.u('P');
update profiles set access_status = 'approved' where id = t.u('L');
-- (Declining an account may also remove its memberships; put L back as a listener of A.)
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.u('L'), t.id('M')) on conflict do nothing;

-- The owner changed before processing: N becomes owner (not a listener) → N in, M stays only as a listener.
update courses set created_by = t.id('N') where id = t.id('A');
delete from course_members where course_id = t.id('A') and user_id = t.id('M');
select t.eq(t.recipients(t.note('S1', 'c1')), 'L,M2,N,T', 'new owner in, old owner (no longer listener) out');
update courses set created_by = t.id('M') where id = t.id('A');
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('M'), t.id('M'));

-- Workspaces: the W2 note goes only to W2's people; the W1 teacher never.
select t.eq(t.recipients(t.mid('xn')), 'XT', 'W2 note: only W2''s teacher (the author XS left out); T never');

-- A multi-row insert (admin, e.g. a data fix): one call per public row, each with its own id; the private row none.
insert into meeting_listener_notes (meeting_id, author_id, body, is_public) values
  (t.mid('c2'), t.id('S1'), 'Row one', true),
  (t.mid('c2'), t.id('M2'), 'Row two', true),
  (t.mid('c2'), t.u('L'), 'Row three', false);
select t.eq(t.calls(), 3::bigint, 'multi-row insert: two calls, none for the private row');
select t.eq((select array_agg(body ->> 'id' order by body ->> 'id') from net.requests where id > 1),
  (select array_agg(x::text order by x::text) from unnest(array[t.note('S1', 'c2'), t.note('M2', 'c2')]) x),
  'each call carries its own note id');

-- Privacy: every body is exactly {"id": ...}.
select t.ok((select bool_and(body ?& array['id'] and (select count(*) from jsonb_object_keys(body)) = 1)
  from net.requests), 'privacy: the body has only the note id');
select t.ok(not exists (select 1 from net.requests where body::text ~ '(Sam on c1|Row one|Row two|Student Sam|Algebra)'),
  'privacy: no note text, author or course in any call');

-- A rejected publish rolls back: private note made public with over-long text fails → not announced, no call.
select t.login('M2');
select t.lives(t.add('c3', 'Mo private', false), 'M2 private note on c3');
select t.throws(t.upd('M2', 'c3', repeat('a', 10001), true), '22001', 'publishing with too-long text is refused');
reset role;
select t.ok(not (select announced or is_public from meeting_listener_notes where id = t.note('M2', 'c3')),
  'refused publish: still private and not announced');
select t.eq(t.calls(), 3::bigint, 'refused publish: no call');
select t.login('M2');
select t.lives(t.upd('M2', 'c3', 'Mo private', true), 'then a valid publish');
reset role;
select t.eq(t.calls(), 4::bigint, 'the valid publish: one call');

-- An empty Vault URL: saved, no call.
update vault.decrypted_secrets set decrypted_secret = '' where name = 'meeting_notes_notify_url';
select t.login('S1');
select t.lives(t.add('c3', 'No URL', true), 'empty URL: still saved');
reset role;
select t.eq(t.calls(), 4::bigint, 'empty URL: no call');
update vault.decrypted_secrets set decrypted_secret = 'https://x.supabase.co/functions/v1/meeting-notes-notifications'
  where name = 'meeting_notes_notify_url';

-- The author's account really deleted: the private note goes, the public one stays without an author; nothing queued,
-- nobody returned.
select t.as('L');
select t.lives(t.add('c1', 'Lee public', true), 'L publishes on c1');
select t.lives(t.add('c3', 'Lee private', false), 'L private on c3');
reset role;
select t.eq(t.calls(), 5::bigint, 'L''s publish: one call');
create temp table lee_note as select t.note('L', 'c1') as id;
grant select on lee_note to service_role;
delete from auth.users where id = t.u('L');
select t.ok(not exists (select 1 from meeting_listener_notes where body = 'Lee private'), 'deleted account: private note gone');
select t.ok((select author_id is null and is_public from meeting_listener_notes where id = (select id from lee_note)),
  'deleted account: public note kept without an author');
select t.eq(t.calls(), 5::bigint, 'deleting the account queues nothing');
select t.eq(t.recipients((select id from lee_note)), '', 'deleted author: nobody');
