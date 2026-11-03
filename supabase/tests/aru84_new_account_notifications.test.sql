-- ARU-84: new_account_notification(), the New accounts switch and the after-insert trigger on profiles that queues the
-- pg_net call when someone signs up. Rules under test: supabase/migrations/0044_new_account_notifications.sql.
-- Fixture (t.seed): teacher T, mentors M, N, M2, students S1-S3, all Approved. New sign-ups are inserted into
-- auth.users (handle_new_user makes the Pending profile) with fixed ids md5('aru84-' || name).
select t.seed();

create function t.uid(name text) returns uuid language sql immutable as $$ select md5('aru84-' || name)::uuid $$;
grant execute on function t.uid(text) to anon, authenticated, service_role;

create function t.signup(name text, full_name text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data)
  values (t.uid(name), name || '@x.test', jsonb_build_object('full_name', full_name))
$$;

grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- The recipient as "<name>:<teacher?>", or '' when there is none. Called as the service role.
create function t.recipient(acc uuid) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select coalesce(string_agg(r.account_name || ':' || case when r.user_id = t.id('T') then 'T' else '?' end, ' | '), '')
    into result from new_account_notification(acc) r;
  reset role;
  return result;
end $$;
grant execute on function t.recipient(uuid) to service_role;

create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant execute on function t.calls() to anon, authenticated, service_role;

-- Fixture sign-ups ran before any Vault secret existed.
select t.eq(t.calls(), 0::bigint, 'fixture sign-ups queued nothing (no secrets)');

-- AC 3: the column and the switch.
select t.ok((select bool_and(attnotnull) from pg_attribute
  where attrelid = 'telegram_links'::regclass and attname = 'notify_new_account'), 'notify_new_account is not null');
insert into telegram_links (user_id, chat_id) values (t.id('T'), 1001), (t.id('M'), 1002);
select t.ok((select notify_new_account from telegram_links where user_id = t.id('T')), 'AC3 on by default');
select t.login('T');
select t.lives('select set_telegram_notification(''new_account'', false)', 'AC3 the teacher turns New accounts off');
reset role;
select t.ok(not (select notify_new_account from telegram_links where user_id = t.id('T')), 'AC3 saved off');
select t.ok((select notify_chat_message and notify_meeting_started from telegram_links where user_id = t.id('T')),
  'AC3 other switches untouched');
select t.ok((select notify_new_account from telegram_links where user_id = t.id('M')), 'AC3 only the caller''s row');
select t.login('T');
select t.lives('select set_telegram_notification(''new_account'', true)', 'AC3 back on');
select t.lives('select set_telegram_notification(''chat_message'', true)', 'earlier kinds still work');
select t.throws('select set_telegram_notification(''nope'', true)', '22023', 'unknown kind is still an error');
reset role;
select t.ok((select notify_new_account from telegram_links where user_id = t.id('T')), 'AC3 saved on');

-- AC 7: grants.
select t.ok(not has_function_privilege('anon', 'new_account_notification(uuid)', 'execute'), 'AC7 anon can''t run it');
select t.ok(not has_function_privilege('authenticated', 'new_account_notification(uuid)', 'execute'),
  'AC7 app users can''t run it');
select t.ok(has_function_privilege('service_role', 'new_account_notification(uuid)', 'execute'), 'AC7 the service role can');
select t.ok(not has_function_privilege('anon', 'notify_new_account()', 'execute')
  and not has_function_privilege('authenticated', 'notify_new_account()', 'execute'),
  'the trigger function isn''t executable by anon or app users');
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc
  where oid = 'notify_new_account()'::regprocedure), 'trigger function: security definer, search_path=public');
select t.login('T');
select t.throws(format('select * from new_account_notification(%L)', t.id('S1')), '42501', 'AC7 the teacher is refused');
select t.login(null);
select t.throws(format('select * from new_account_notification(%L)', t.id('S1')), '42501', 'AC7 anon is refused');
reset role;

-- AC 6 / AC 9 (i): no Vault secrets -> sign-up succeeds, nothing queued.
select t.lives($$select t.signup('a', 'Dana Serikova')$$, 'AC6 sign-up with no Vault secrets');
select t.eq((select access_status::text from profiles where id = t.uid('a')), 'pending', 'the account waits');
select t.eq(t.calls(), 0::bigint, 'AC9(i) no secrets: no call');

-- Only the URL -> still skipped.
insert into vault.decrypted_secrets values ('new_account_notify_url', 'https://example.supabase.co/functions/v1/new-account-notifications');
select t.lives($$select t.signup('b', 'Bob')$$, 'sign-up with only the URL');
select t.eq(t.calls(), 0::bigint, 'a missing secret: no call');

-- AC 5 / AC 9: recipient function.
select t.eq(t.recipient(t.uid('a')), 'Dana Serikova:T', 'AC9 pending: the name and the teacher');
select t.eq(t.recipient(t.id('S1')), '', 'AC9 approved: nothing');
select t.eq(t.recipient(t.uid('nope')), '', 'AC9 unknown id: nothing');
select t.eq(t.recipient(t.id('T')), '', 'the teacher''s own profile: nothing');
select t.login('T');
select t.lives(format('select set_access_status(%L, ''rejected'')', t.uid('b')), 'the teacher declines b');
reset role;
select t.eq(t.recipient(t.uid('b')), '', 'AC5/AC9 rejected: nothing');

-- AC 9 (iii): with both secrets, a sign-up queues exactly one call with the id, the header and a timeout.
insert into vault.decrypted_secrets values ('new_account_notify_secret', 's3cret');
select t.lives($$select t.signup('c', 'Дана "*_<b>" 😀')$$, 'sign-up with the secrets set');
select t.eq(t.calls(), 1::bigint, 'AC9(iii) exactly one call');
select t.eq((select url from net.requests order by id desc limit 1),
  'https://example.supabase.co/functions/v1/new-account-notifications', 'posted to the Vault URL');
select t.eq((select body from net.requests order by id desc limit 1), jsonb_build_object('user_id', t.uid('c')),
  'body is {"user_id": "<id>"} only');
select t.eq((select headers ->> 'Authorization' from net.requests order by id desc limit 1), 'Bearer s3cret',
  'Authorization: Bearer <secret>');
select t.eq((select timeout_milliseconds from net.requests order by id desc limit 1), 5000, 'explicit 5 s timeout');
select t.eq(t.recipient(t.uid('c')), 'Дана "*_<b>" 😀:T', 'the name as typed');

-- AC 4 / AC 9 (iv)(v): approve, decline, role change, name change -> no call.
select t.login('T');
select t.lives(format('select set_access_status(%L, ''approved'')', t.uid('c')), 'the teacher accepts c');
select t.lives(format('select set_access_status(%L, ''rejected'')', t.uid('a')), 'the teacher declines a');
select t.lives(format('select set_user_role(%L, ''mentor'')', t.uid('c')), 'role change');
reset role;
select t.login('S1');
select t.lives(format('update profiles set full_name = %L where id = %L', 'Sam New', t.id('S1')), 'name change');
reset role;
update profiles set access_status = 'pending' where id = t.id('S2');
select t.eq(t.calls(), 1::bigint, 'AC4 status, role and name updates: no call');
update profiles set access_status = 'approved' where id = t.id('S2');
select t.eq(t.recipient(t.uid('c')), '', 'AC5 accepted before processing: nothing');

-- AC 5: deleted before processing -> nothing.
select t.lives($$select t.signup('d', 'Dee')$$, 'd signs up');
delete from auth.users where id = t.uid('d');
select t.eq(t.recipient(t.uid('d')), '', 'AC5 deleted: nothing');

-- AC 8: three sign-ups -> three calls, one per account.
select t.lives($$select t.signup('x', 'X')$$, 'x');
select t.lives($$select t.signup('y', 'Y')$$, 'y');
select t.lives($$select t.signup('z', 'Z')$$, 'z');
select t.eq((select string_agg(body ->> 'user_id', ',' order by id) from net.requests where id > 2),
  t.uid('x') || ',' || t.uid('y') || ',' || t.uid('z'), 'AC8 one call per sign-up, each with its id');

-- Analysis note 3: the sign-up runs as the Auth role, which has no Vault access -> still succeeds and is queued.
create role aru84_auth_admin nologin;
grant usage on schema auth to aru84_auth_admin;
grant insert on auth.users to aru84_auth_admin;
select t.ok(not has_table_privilege('aru84_auth_admin', 'vault.decrypted_secrets', 'select'), 'the Auth role has no Vault access');
set role aru84_auth_admin;
insert into auth.users (id, email, raw_user_meta_data)
  values (md5('aru84-auth')::uuid, 'auth@x.test', '{"full_name":"Via Auth"}');
reset role;
select t.ok(exists (select 1 from profiles where id = t.uid('auth') and access_status = 'pending'),
  'sign-up as the Auth role makes the pending profile');
select t.eq((select body ->> 'user_id' from net.requests order by id desc limit 1), t.uid('auth')::text,
  'and the call is queued (security definer)');

-- AC 4: no teacher yet -> the recipient returns nothing (no error).
set session_replication_role = replica;
update profiles set role = 'mentor' where id = t.id('T');
set session_replication_role = origin;
select t.eq(t.recipient(t.uid('x')), '', 'no teacher: nothing');
set session_replication_role = replica;
update profiles set role = 'teacher' where id = t.id('T');
set session_replication_role = origin;

-- AC 4: a profile that is Approved at insert time (the teacher's, set by the before-insert trigger) -> no call.
select count(*) as before from net.requests \gset
insert into auth.users (id, email) values (t.uid('t2'), 't2@x.test');
select t.eq(t.calls(), (:before)::bigint + 1, 'control: a pending insert queues one call');
delete from auth.users where id = t.uid('t2');
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values (t.uid('t3'), 't3@x.test');
alter table auth.users enable trigger on_auth_user_created;
insert into profiles (id, full_name, access_status) values (t.uid('t3'), 'Approved at insert', 'approved');
select t.eq(t.calls(), (:before)::bigint + 1, 'AC4 a profile inserted Approved: no call');

-- AC 6 / AC 9 (ii): net.http_post raising -> sign-up still succeeds.
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language plpgsql as $$ begin raise exception 'pg_net is down'; end $$;
select t.lives($$select t.signup('e', 'Eve')$$, 'AC9(ii) sign-up succeeds when net.http_post raises');
select t.ok(exists (select 1 from profiles where id = t.uid('e') and access_status = 'pending'), 'AC6 and the account exists');

-- AC 6: pg_net not installed at all -> still succeeds.
drop function net.http_post(text, jsonb, jsonb, jsonb, integer);
select t.lives($$select t.signup('f', 'Fay')$$, 'AC6 sign-up succeeds without pg_net');

-- AC 6: Vault missing entirely -> still succeeds.
drop table vault.decrypted_secrets;
select t.lives($$select t.signup('g', 'Gus')$$, 'AC6 sign-up succeeds without Vault');

select t.ok(not exists (select 1 from pg_policies where policyname ilike '%account%notif%'), 'no new RLS policy');
