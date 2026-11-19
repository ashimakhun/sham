-- ARU-166 QA: gaps around supabase/migrations/0069_push_notifications.sql that the dev tests don't cover:
-- account deletion through Auth (the real ARU-75 path) in both workspaces, the Telegram switch copy for an account in
-- another workspace, the workspace guard on direct service-role writes, Telegram links that never limit push
-- recipients (every recipient function), and what a waiting / declined / other-workspace account can see or do.
select t.seed();
create function t.u(n text) returns uuid language sql immutable as $$
  select coalesce(t.id(n), md5('aru166qa' || n)::uuid) $$;
grant execute on function t.u(text) to anon, authenticated, service_role;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

insert into workspaces (id, name, created_at) values (t.u('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.u('P'), 'p166qa@x.test', '{"full_name":"Pat Pending"}'),
  (t.u('D'), 'd166qa@x.test', '{"full_name":"Dan Declined"}'),
  (t.u('X'), 'x166qa@x.test', '{"full_name":"Xia Student"}'),
  (t.u('XT'), 'xt166qa@x.test', '{"full_name":"Xu Teacher"}');
update profiles set access_status = 'pending' where id = t.u('P');
update profiles set access_status = 'rejected' where id = t.u('D');
update profiles set workspace_id = t.u('W2'), access_status = 'approved' where id in (t.u('X'), t.u('XT'));
update profiles set role = 'teacher' where id = t.u('XT');

create function t.as(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.u(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.as(text) to anon, authenticated;
create function t.tok(n text) returns text language sql immutable as $$ select 'ExponentPushToken[' || n || ']' $$;
grant execute on function t.tok(text) to anon, authenticated, service_role;
create function t.hint(stmt text) returns text language plpgsql as $$
declare h text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end $$;
grant execute on function t.hint(text) to anon, authenticated;

-- Access: anon is refused outright (no EXECUTE), and sees no rows.
select t.login(null);
select t.throws($$select register_push_device('d', 'ExponentPushToken[a]', 'ios')$$, '42501', 'access: anon can''t register');
select t.throws($$select unregister_push_device('d')$$, '42501', 'access: anon can''t unregister');
select t.throws($$select set_notification('chat_message', false)$$, '42501', 'access: anon can''t change switches');
select t.throws($$select count(*) from push_devices$$, '42501', 'access: anon can''t read push_devices');
select t.throws($$select count(*) from notification_settings$$, '42501', 'access: anon can''t read notification_settings');
reset role;

-- AC 5: declined can't change switches either (waiting is covered by the dev test).
select t.as('D');
select t.eq(t.hint($$select set_notification('chat_message', false)$$), 'sham:notifications_not_accepted',
  'AC5 a declined account can''t change switches');
select t.lives($$select unregister_push_device('none')$$, 'AC5 a declined account can unregister (no error when none)');
reset role;
select t.ok(not exists (select 1 from notification_settings where user_id = t.u('D')), 'AC5 no settings row for D');

-- Workspaces: X (W2) registers; rows land in W2; T (first workspace) sees nothing of it.
select t.as('X');
select t.lives(format('select register_push_device(%L, %L, %L)', 'x-phone', t.tok('x1'), 'android'), 'X registers');
select t.lives($$select set_notification('general_chat', false)$$, 'X saves a switch');
select t.eq((select count(*) from push_devices), 1::bigint, 'X sees their own phone');
reset role;
select t.ok((select workspace_id = t.u('W2') from push_devices where user_id = t.u('X'))
  and (select workspace_id = t.u('W2') from notification_settings where user_id = t.u('X')),
  'workspaces: X''s phone and switches are in W2');
select t.as('T');
select t.eq((select count(*) from push_devices), 0::bigint, 'access: the teacher sees nobody else''s phones');
select t.eq((select count(*) from notification_settings), 0::bigint, 'access: the teacher sees nobody else''s switches');
reset role;

-- The workspace guard: an admin write naming another workspace is put in its user's workspace, and a row never moves.
insert into push_devices (user_id, device_id, token, platform, workspace_id)
  values (t.id('S1'), 'admin', t.tok('wrong-ws'), 'ios', t.u('W2'));
select t.ok((select workspace_id = default_workspace() from push_devices where device_id = 'admin'),
  'guard: a phone always lands in its user''s workspace');
delete from push_devices where device_id = 'admin';
update notification_settings set workspace_id = default_workspace() where user_id = t.u('X');
select t.ok((select workspace_id = t.u('W2') from notification_settings where user_id = t.u('X')),
  'guard: settings never change workspace');

-- AC 8: the migration's copy, for a Telegram link of an account in another workspace (the row goes to W2).
delete from notification_settings;
insert into telegram_links (user_id, chat_id) values (t.u('X'), 7701), (t.id('M'), 7702);
update telegram_links set notify_general_chat = false, notify_meeting_notes = false where user_id = t.u('X');
\set copy_sql `sed -n '/^insert into notification_settings (/,/^on conflict (user_id) do nothing;/p' supabase/migrations/0069_push_notifications.sql`
:copy_sql
select t.ok((select workspace_id = t.u('W2') and not notify_general_chat and not notify_meeting_notes and notify_chat_message
  from notification_settings where user_id = t.u('X')), 'AC8 a W2 account''s copied row is in W2 with its values');
select t.ok((select workspace_id = default_workspace() and notify_general_chat from notification_settings
  where user_id = t.id('M')), 'AC8 a first-workspace account''s copied row: all on, first workspace');
-- Running the copy again (a re-run) changes nothing and doesn't fail.
update notification_settings set notify_chat_message = false where user_id = t.id('M');
:copy_sql
select t.ok((select not notify_chat_message from notification_settings where user_id = t.id('M')),
  'AC8 the copy never overwrites switches already saved');

-- AC 4: account deletion through Auth (ARU-75: `delete from auth.users` as the admin) removes phones and switches,
-- in the first workspace and in W2.
select t.as('S3');
select t.lives(format('select register_push_device(%L, %L, %L)', 's3-a', t.tok('s3a'), 'ios'), 'S3 phone 1');
select t.lives(format('select register_push_device(%L, %L, %L)', 's3-b', t.tok('s3b'), 'android'), 'S3 phone 2');
select t.lives($$select set_notification('new_material', false)$$, 'S3 switch');
reset role;
select t.lives(format('delete from auth.users where id = %L', t.id('S3')), 'AC4 S3''s Auth user is deleted');
select t.ok(not exists (select 1 from push_devices where user_id = t.id('S3'))
  and not exists (select 1 from notification_settings where user_id = t.id('S3')),
  'AC4 S3''s two phones and switches are gone');
select t.lives(format('delete from auth.users where id = %L', t.u('X')), 'AC4 X''s (W2) Auth user is deleted');
select t.ok(not exists (select 1 from push_devices where user_id = t.u('X'))
  and not exists (select 1 from notification_settings where user_id = t.u('X')),
  'AC4 X''s phone and switches (W2) are gone');

-- AC 9: no recipient function depends on a Telegram link any more (also the ones the story didn't replace).
select t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ilike '%telegram_links%'
    and p.proname not in ('disconnect_telegram', 'link_telegram_chat', 'set_telegram_notification', 'unlink_telegram_chat')),
  'AC9 only the Telegram page''s own functions still read telegram_links');
-- Every function a notification Edge Function calls still keeps waiting / declined accounts out (Approved only).
select t.ok((select bool_and(p.prosrc ilike '%approved%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('chat_message_recipients', 'general_message_recipients',
    'new_material_recipients', 'meeting_notes_recipients', 'new_homework_recipients', 'homework_reviewed_recipient',
    'homework_submitted_recipient', 'new_account_notification', 'claim_started_meetings', 'claim_photo_deletion_warnings')),
  'AC9 every recipient function still checks Approved');

-- AC 9: a waiting or declined member of the course never gets meeting notes, linked to Telegram or not.
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.u('P'), t.id('M')), (t.id('A'), t.u('D'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M'));
insert into telegram_links (user_id, chat_id) values (t.u('P'), 7703);
set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.u('mtg'), t.id('A'), now() - interval '1 day', 'completed', t.id('M'));
insert into meeting_listener_notes (id, meeting_id, course_id, author_id, body, is_public) values
  (t.u('note'), t.u('mtg'), t.id('A'), t.id('M'), 'Notes', true);
set session_replication_role = origin;
create function t.names(ids uuid[]) returns text language sql as $$
  select string_agg(k, ',' order by k) from unnest(array['T','M','N','M2','S1','S2','S3','P','D','X','XT']) k
  where t.u(k) = any (ids) $$;
grant execute on function t.names(uuid[]) to service_role;
set role service_role;
select t.eq(t.names(array(select user_id from meeting_notes_recipients(t.u('note')))), 'S2,T',
  'AC9 meeting notes by the owner: Approved listeners (no Telegram link needed) and the teacher; never P or D; not the author');
reset role;
