-- ARU-166: push devices, notification settings, their functions, the Telegram switch copy and the two recipient
-- functions without the Telegram join. Rules under test: supabase/migrations/0069_push_notifications.sql.
-- Fixture (t.seed): approved T, M, N, M2, S1, S2, S3; course A (owner M), B (owner N). Here also: P (waiting),
-- D (declined), W2 (another workspace) with its approved student X.
select t.seed();
create function t.u(n text) returns uuid language sql immutable as $$
  select coalesce(t.id(n), md5('aru166' || n)::uuid) $$;
grant execute on function t.u(text) to anon, authenticated, service_role;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

insert into workspaces (id, name, created_at) values (t.u('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.u('P'), 'p166@x.test', '{"full_name":"Pat Pending"}'),
  (t.u('D'), 'd166@x.test', '{"full_name":"Dan Declined"}'),
  (t.u('X'), 'x166@x.test', '{"full_name":"Xia Student"}');
update profiles set access_status = 'pending' where id = t.u('P');
update profiles set access_status = 'rejected' where id = t.u('D');
update profiles set workspace_id = t.u('W2'), access_status = 'approved' where id = t.u('X');

create function t.as(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.u(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.as(text) to anon, authenticated;

-- Every push device as the admin sees it: "<who>:<device>:<token>" sorted, '' when none.
create function t.devices() returns text language sql security definer as $$
  select coalesce(string_agg(coalesce((select k from unnest(array['T','M','N','M2','S1','S2','S3','P','D','X']) k
      where t.u(k) = d.user_id), '?') || ':' || d.device_id || ':' || d.token, ',' order by 1), '')
  from public.push_devices d $$;
grant execute on function t.devices() to anon, authenticated, service_role;
create function t.tok(n text) returns text language sql immutable as $$ select 'ExponentPushToken[' || n || ']' $$;
grant execute on function t.tok(text) to anon, authenticated, service_role;
create function t.reg(device text, token text, platform text default 'ios') returns text language sql as $$
  select format('select register_push_device(%L, %L, %L)', device, token, platform) $$;
grant execute on function t.reg(text, text, text) to anon, authenticated;
-- The hint of the error a statement raises, or 'no error'.
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

-- Data checks.
select t.ok((select relrowsecurity from pg_class where oid = 'public.push_devices'::regclass), 'data: RLS on push_devices');
select t.ok((select relrowsecurity from pg_class where oid = 'public.notification_settings'::regclass),
  'data: RLS on notification_settings');
select t.ok((select bool_and(prosecdef and 'search_path=public' = any(proconfig)) from pg_proc where proname in
  ('register_push_device', 'unregister_push_device', 'set_notification')), 'data: functions are security definer, search_path = public');
select t.ok(not has_function_privilege('anon', 'register_push_device(text, text, text)', 'execute')
  and not has_function_privilege('anon', 'unregister_push_device(text)', 'execute')
  and not has_function_privilege('anon', 'set_notification(text, boolean)', 'execute'), 'access: anon can''t run the three functions');
select t.ok(has_function_privilege('authenticated', 'register_push_device(text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'unregister_push_device(text)', 'execute')
  and has_function_privilege('authenticated', 'set_notification(text, boolean)', 'execute'), 'access: signed-in users can');
select t.eq((select array_agg(column_name::text order by column_name::text) from information_schema.columns
  where table_schema = 'public' and table_name = 'push_devices'),
  array['device_id', 'platform', 'token', 'updated_at', 'user_id', 'workspace_id'], 'AC2 a registration holds only these columns');
select t.ok((select count(*) = 2 from pg_trigger where tgname = 'zz_workspace_guard'
  and tgrelid in ('public.push_devices'::regclass, 'public.notification_settings'::regclass)), 'data: both tables have the workspace guard');
select t.ok(not has_function_privilege('authenticated', 'new_material_recipients(text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'meeting_notes_recipients(uuid)', 'execute')
  and has_function_privilege('service_role', 'new_material_recipients(text, uuid)', 'execute')
  and has_function_privilege('service_role', 'meeting_notes_recipients(uuid)', 'execute'),
  'access: the recipient functions stay service_role only');

-- AC 1 / AC 2: register, again (no duplicate), a changed token replaces the old one.
select t.as('S1');
select t.lives(t.reg('dev-1', t.tok('a')), 'AC2 S1 registers a phone');
select t.lives(t.reg('dev-1', t.tok('a')), 'AC2 registering again works');
reset role;
select t.eq(t.devices(), 'S1:dev-1:' || t.tok('a'), 'AC2 one row, no duplicate');
select t.ok((select platform = 'ios' and workspace_id = (select workspace_id from profiles where id = t.id('S1'))
  from push_devices), 'AC2 platform and the account''s workspace are stored');
select t.as('S1');
select t.lives(t.reg('dev-1', t.tok('b'), 'android'), 'AC2 a changed token');
select t.lives(t.reg('dev-2', t.tok('c'), 'android'), 'several phones: a second phone');
reset role;
select t.eq(t.devices(), 'S1:dev-1:' || t.tok('b') || ',S1:dev-2:' || t.tok('c'), 'AC2 the changed token replaced the old one');

-- AC 2: another person signs in on the same phone: the token moves (same workspace).
select t.as('S2');
select t.lives(t.reg('dev-1', t.tok('b')), 'AC2 S2 registers S1''s phone');
reset role;
select t.eq(t.devices(), 'S1:dev-2:' || t.tok('c') || ',S2:dev-1:' || t.tok('b'), 'AC2 the phone now belongs to S2 only');

-- AC 2: the token moves to an account in another workspace (delete + insert, no guard error) and back.
select t.as('X');
select t.lives(t.reg('dev-1', t.tok('b')), 'AC2 X (other workspace) registers the same phone');
reset role;
select t.eq(t.devices(), 'S1:dev-2:' || t.tok('c') || ',X:dev-1:' || t.tok('b'), 'AC2 moved to X across workspaces');
select t.eq((select workspace_id from push_devices where user_id = t.u('X')), t.u('W2'), 'AC2 the new row is in X''s workspace');
select t.as('S2');
select t.lives(t.reg('dev-1', t.tok('b')), 'AC2 back to S2 from the other workspace');
reset role;
select t.eq(t.devices(), 'S1:dev-2:' || t.tok('c') || ',S2:dev-1:' || t.tok('b'), 'AC2 moved back');

-- AC 2: same token under a new device id (app reinstalled keeps no install id): the old row goes.
select t.as('S2');
select t.lives(t.reg('dev-1b', t.tok('b')), 'AC2 the same token from a new install id');
reset role;
select t.eq(t.devices(), 'S1:dev-2:' || t.tok('c') || ',S2:dev-1b:' || t.tok('b'), 'AC2 the token is never stored twice');

-- Validation.
select t.as('S1');
select t.eq(t.hint(t.reg('dev-x', 'not-a-token')), 'sham:push_token_invalid', 'a bad token is refused');
select t.eq(t.hint(t.reg('dev-x', 'ExpoPushToken[]')), 'sham:push_token_invalid', 'an empty token is refused');
select t.eq(t.hint(t.reg('dev-x', t.tok('z'), 'web')), 'sham:push_platform_invalid', 'a platform other than ios/android is refused');
select t.eq(t.hint(t.reg('', t.tok('z'))), 'sham:push_device_invalid', 'an empty device id is refused');
select t.eq(t.hint(t.reg(repeat('x', 101), t.tok('z'))), 'sham:push_device_invalid', 'a too long device id is refused');
reset role;

-- AC 5: waiting and declined accounts register nothing; they can unregister.
select t.as('P');
select t.eq(t.hint(t.reg('dev-p', t.tok('p'))), 'sham:notifications_not_accepted', 'AC5 a waiting account is refused');
select t.lives($$select unregister_push_device('dev-p')$$, 'AC5 a waiting account can unregister (no error when none)');
select t.eq(t.hint($$select set_notification('chat_message', false)$$), 'sham:notifications_not_accepted',
  'AC5 a waiting account can''t change switches');
reset role;
select t.as('D');
select t.eq(t.hint(t.reg('dev-d', t.tok('d'))), 'sham:notifications_not_accepted', 'AC5 a declined account is refused');
reset role;
select t.login(null);
select t.throws(t.reg('dev-a', t.tok('anon')), '42501', 'access: anon can''t register');
reset role;
select t.ok(t.devices() !~ 'P:|D:', 'AC5 nothing registered for waiting or declined accounts');

-- Access: own rows only, no direct writes.
select t.as('S1');
select t.eq((select count(*) from push_devices), 1::bigint, 'access: S1 reads only their own phone');
select t.throws($$insert into push_devices (user_id, device_id, token, platform) values (auth.uid(), 'd', 'ExponentPushToken[q]', 'ios')$$,
  '42501', 'access: no direct insert');
select t.throws($$update push_devices set token = 'ExponentPushToken[q]'$$, '42501', 'access: no direct update');
select t.throws($$delete from push_devices$$, '42501', 'access: no direct delete');
select t.throws($$insert into notification_settings (user_id) values (auth.uid())$$, '42501', 'access: no direct settings insert');
select t.throws($$update notification_settings set notify_chat_message = false$$, '42501', 'access: no direct settings update');
select t.throws($$delete from notification_settings$$, '42501', 'access: no direct settings delete');
reset role;
select t.as('S2');
select t.eq((select count(*) from push_devices where user_id = t.id('S1')), 0::bigint, 'access: S2 doesn''t see S1''s phones');
reset role;
select t.login(null);
select t.throws($$select count(*) from push_devices$$, '42501', 'access: anon can''t read phones');
select t.throws($$select count(*) from notification_settings$$, '42501', 'access: anon can''t read settings');
reset role;

-- AC 4: unregister removes only the caller's row for that device.
select t.as('S2');
select t.lives($$select unregister_push_device('dev-2')$$, 'AC4 S2 unregistering S1''s device id does nothing');
reset role;
select t.ok(t.devices() ~ 'S1:dev-2:', 'AC4 S1''s phone is still there');
select t.as('S1');
select t.lives($$select unregister_push_device('dev-2')$$, 'AC4 S1 unregisters this phone (sign out)');
reset role;
select t.ok(t.devices() !~ 'S1:', 'AC4 S1''s registration is gone');

-- AC 8: switches. No row means all on; the first flip creates the row.
select t.ok(not exists (select 1 from notification_settings where user_id = t.id('S3')), 'AC8 S3 has no settings row');
select t.as('S3');
select t.eq((select count(*) from notification_settings), 0::bigint, 'AC8 the page reads no row (= all on), no error');
select t.lives($$select set_notification('chat_message', false)$$, 'AC8 S3 turns Chat messages off');
select t.eq((select count(*) from notification_settings), 1::bigint, 'AC8 the first flip created the row');
select t.ok((select not notify_chat_message and notify_meeting_started and notify_general_chat and notify_new_account
  and notify_meeting_notes from notification_settings), 'AC8 only that switch is off');
select t.lives($$select set_notification('chat_message', true)$$, 'AC8 on again');
select t.ok((select notify_chat_message from notification_settings), 'AC8 saved on');
select t.eq(t.hint($$select set_notification('telegram', true)$$), 'sham:notification_kind_unknown', 'an unknown kind is refused');
select t.eq(t.hint($$select set_notification(null, true)$$), 'sham:notification_kind_unknown', 'no kind is refused');
select t.eq(t.hint($$select set_notification('chat_message', null)$$), 'sham:choose_on_off', 'no value is refused');
reset role;
select t.as('S2');
select t.eq((select count(*) from notification_settings), 0::bigint, 'access: S2 doesn''t read S3''s settings');
reset role;

-- Every kind the app has can be saved.
select t.as('M');
select t.lives($$select set_notification(k, false) from unnest(array['meeting_started', 'new_homework', 'homework_reviewed',
  'photo_deletion', 'homework_submitted', 'chat_message', 'general_chat', 'new_material', 'meeting_notes', 'new_account']) k$$,
  'AC8 all ten kinds can be saved');
select t.ok((select not (notify_meeting_started or notify_new_homework or notify_homework_reviewed or notify_photo_deletion
  or notify_homework_submitted or notify_chat_message or notify_general_chat or notify_new_material or notify_meeting_notes
  or notify_new_account) from notification_settings), 'AC8 all ten are off');
reset role;

-- AC 8: the migration copies Telegram switch values (its own statement, run again on links made here).
delete from notification_settings;
insert into telegram_links (user_id, chat_id) values (t.id('S1'), 6601), (t.id('T'), 6602);
update telegram_links set notify_chat_message = false, notify_photo_deletion = false where user_id = t.id('S1');
update telegram_links set notify_new_account = false where user_id = t.id('T');
\set copy_sql `sed -n '/^insert into notification_settings (/,/^on conflict (user_id) do nothing;/p' supabase/migrations/0069_push_notifications.sql`
:copy_sql
select t.eq((select count(*) from notification_settings), 2::bigint, 'AC8 one settings row per Telegram link');
select t.ok((select not notify_chat_message and not notify_photo_deletion and notify_meeting_started and notify_general_chat
  from notification_settings where user_id = t.id('S1')), 'AC8 S1''s values are copied');
select t.ok((select not notify_new_account and notify_chat_message from notification_settings where user_id = t.id('T')),
  'AC8 T''s values are copied');
select t.eq((select count(*) from telegram_links), 2::bigint, 'AC8 no Telegram link is changed or deleted');

-- AC 4: deleting an account removes its phones and settings.
select t.as('S2');
select t.lives(t.reg('dev-s2', t.tok('s2')), 'S2 has a phone');
select t.lives($$select set_notification('chat_message', false)$$, 'S2 has settings');
reset role;
delete from profiles where id = t.id('S2');
select t.ok(not exists (select 1 from push_devices where user_id = t.id('S2'))
  and not exists (select 1 from notification_settings where user_id = t.id('S2')),
  'AC4 a deleted account''s phones and settings are gone');

-- AC 9: the two replaced recipient functions return users with no Telegram link (only S1 and T have one now).
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S3'), t.id('M'));
set session_replication_role = replica;
insert into materials (id, teacher_id, title, body) values (t.u('blog'), t.id('M'), 'Exam tips', 'Body');
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.u('mtg'), t.id('A'), now() - interval '1 day', 'completed', t.id('M'));
insert into meeting_listener_notes (id, meeting_id, course_id, author_id, body, is_public) values
  (t.u('note'), t.u('mtg'), t.id('A'), t.id('S3'), 'Notes', true);
set session_replication_role = origin;
create function t.names(ids uuid[]) returns text language sql as $$
  select string_agg(k, ',' order by k) from unnest(array['T','M','N','M2','S1','S2','S3','P','D','X']) k where t.u(k) = any (ids) $$;
grant execute on function t.names(uuid[]) to service_role;
set role service_role;
select t.eq(t.names(array(select user_id from new_material_recipients('blog', t.u('blog')))), 'M2,N,S1,S3,T',
  'AC9 new materials: everyone readable, linked or not, not the author, not other workspaces, not waiting');
select t.eq(t.names(array(select user_id from meeting_notes_recipients(t.u('note')))), 'M,T',
  'AC9 meeting notes: owner and teacher, with or without Telegram; not the author');
reset role;
-- ARU-162 is kept: someone who blocked the author gets nothing.
insert into user_blocks (blocker_id, blocked_id) values (t.id('N'), t.id('M'));
set role service_role;
select t.eq(t.names(array(select user_id from new_material_recipients('blog', t.u('blog')))), 'M2,S1,S3,T',
  'AC9 a person who blocked the author gets no push (ARU-162 kept)');
reset role;
