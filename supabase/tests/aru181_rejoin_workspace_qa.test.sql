-- ARU-181 QA: checks the dev tests (aru181_rejoin_workspace.test.sql) don't cover. Rules under test:
-- supabase/migrations/0079_rejoin_workspace.sql.
--   * AC 7: legal agreements and the recovery code survive the deletion and the join / create; notification switches
--     start from the defaults.
--   * The guard: an approved member or teacher can't move workspaces, even inside a security definer function with the
--     flag set for themselves; a deactivated account can't set its own role / status; the flag doesn't outlive a call.
--   * A deactivated or waiting rejoiner reads and writes nothing of any workspace.
--   * Concurrency (two sessions, via dblink): a join while that workspace is being deleted (both orders), and two
--     parallel calls of the same account (join + create, create + create).
-- W1 is the fixture's workspace (t.seed()); its teacher deletes it, so M, N, M2, S1, S2, S3 are deactivated.
-- W2 (teacher XT, student XS), W3 (teacher YT) and W4 (teacher ZT) are other workspaces.
select t.seed();
create extension if not exists dblink;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

create function t.r(n text) returns uuid language sql immutable as $$ select md5('aru181qa' || n)::uuid $$;
grant execute on function t.r(text) to anon, authenticated, service_role;
create function t.rlogin(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.r(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.rlogin(text) to anon, authenticated;

-- What a statement raises: errcode | hint (or 'no error').
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return concat_ws(' | ', code, nullif(hint, ''));
end $$;
grant execute on function pg_temp.err(text) to authenticated, anon, service_role;

insert into vault.decrypted_secrets values ('new_account_notify_url', 'https://x.test/new-account'), ('new_account_notify_secret', 's');

-- Other workspaces and their people (made as the admin).
insert into workspaces (id, name) values (t.r('W2'), 'Other school'), (t.r('W3'), 'Third school'), (t.r('W4'), 'Fourth school');
insert into auth.users (id, email, raw_user_meta_data) values
  (t.r('XT'), 'xt@x.test', '{"full_name":"Xena Teacher"}'),
  (t.r('XS'), 'xs@x.test', '{"full_name":"Xia Student"}'),
  (t.r('YT'), 'yt@x.test', '{"full_name":"Yan Teacher"}'),
  (t.r('ZT'), 'zt@x.test', '{"full_name":"Zed Teacher"}');
update profiles set workspace_id = t.r('W2') where id in (t.r('XT'), t.r('XS'));
update profiles set workspace_id = t.r('W3') where id = t.r('YT');
update profiles set workspace_id = t.r('W4') where id = t.r('ZT');
update profiles set access_status = 'approved' where id in (t.r('XT'), t.r('XS'), t.r('YT'), t.r('ZT'));
update profiles set role = 'teacher' where id in (t.r('XT'), t.r('YT'), t.r('ZT'));
insert into general_messages (author_id, body) values (t.r('XT'), 'Hello W2');
create table qa_codes as select workspace, code from workspace_invite_codes;
grant select on qa_codes to authenticated;
create function t.code(ws text) returns text language sql stable as $$ select code from qa_codes where workspace = t.r(ws) $$;
grant execute on function t.code(text) to authenticated, service_role;

-- AC 7 data that must survive: agreements and recovery codes of S1 and S2; S1 had turned a switch off.
insert into legal_agreements (user_id, version) values (t.id('S1'), 1), (t.id('S2'), 1);
insert into recovery_codes (user_id, code_hash, saved_at) values (t.id('S1'), 'hash-s1', now()), (t.id('S2'), 'hash-s2', now());
insert into notification_settings (user_id, notify_new_homework) values (t.id('S1'), false)
  on conflict (user_id) do update set notify_new_homework = false;

-- W1 is deleted (files first, as the Edge Function does).
delete from storage.objects;
set role service_role;
select delete_workspace(t.id('T'));
reset role;
select t.eq((select count(*) from profiles where access_status = 'deactivated')::int, 6, 'setup: six deactivated accounts');
delete from net.requests;

-- A deactivated account reads and writes nothing of any workspace.
select t.login('S3');
select t.eq((select count(*) from workspaces)::int, 0, 'deactivated: reads no workspace');
select t.eq((select count(*) from profiles)::int, 1, 'deactivated: reads only its own profile');
select t.eq((select count(*) from general_messages)::int, 0, 'deactivated: reads no chat message');
select t.ok(pg_temp.err($$insert into general_messages (author_id, body) values (auth.uid(), 'hi')$$) <> 'no error',
  'deactivated: can''t post in a general chat');
select t.ok(pg_temp.err($$insert into courses (title, created_by) values ('Mine', auth.uid())$$) <> 'no error',
  'deactivated: can''t create a course');
-- The guard and the column grants: no way to set its own role or status, or a workspace, by hand.
select t.ok(pg_temp.err($$update profiles set access_status = 'approved' where id = auth.uid()$$) like '42501%',
  'deactivated: can''t approve itself with a direct update');
select t.ok(pg_temp.err($$update profiles set role = 'teacher' where id = auth.uid()$$) like '42501%',
  'deactivated: can''t make itself a teacher with a direct update');
select set_config('sham.rejoining', t.id('S3')::text, false);
select t.ok(pg_temp.err(format('update profiles set workspace_id = %L, role = ''teacher'', access_status = ''approved'' where id = auth.uid()', t.r('W2'))) like '42501%',
  'deactivated: can''t join as an approved teacher with the flag set by hand');
select set_config('sham.rejoining', '', false);
reset role;
select t.eq((select concat_ws(',', workspace_id is null, role, access_status) from profiles where id = t.id('S3')),
  't,student,deactivated', 'deactivated: S3 unchanged');

-- The guard for members that aren't deactivated: even with the flag set for themselves, inside a security definer
-- function (the strongest an app call can get), an approved student or teacher can't move to another workspace.
create function pg_temp.move_me(ws uuid) returns void language plpgsql security definer as $$
begin
  perform set_config('sham.rejoining', auth.uid()::text, true);
  update profiles set workspace_id = ws where id = auth.uid();
end $$;
grant execute on function pg_temp.move_me(uuid) to authenticated;
select t.rlogin('XS');
select t.eq(pg_temp.err(format('select pg_temp.move_me(%L)', t.r('W3'))), '42501 | sham:workspace_locked',
  'guard: an approved student can''t move to another workspace');
reset role;
select t.rlogin('XT');
select t.eq(pg_temp.err(format('select pg_temp.move_me(%L)', t.r('W3'))), '42501 | sham:workspace_locked',
  'guard: a teacher can''t move to another workspace');
reset role;
-- Nor move a deactivated account into their own workspace (someone else's row).
create function pg_temp.pull(who uuid) returns void language plpgsql security definer as $$
begin
  perform set_config('sham.rejoining', who::text, true);
  update profiles set workspace_id = my_workspace(), access_status = 'pending' where id = who;
end $$;
grant execute on function pg_temp.pull(uuid) to authenticated;
select t.rlogin('XT');
select t.ok(pg_temp.err(format('select pg_temp.pull(%L)', t.id('S3'))) like '42501%',
  'guard: a teacher can''t pull a deactivated account into their workspace');
reset role;
select t.eq((select string_agg(concat_ws(':', full_name, workspace_id = t.r('W2')), ',' order by full_name) from profiles where id in (t.r('XS'), t.r('XT'))),
  'Xena Teacher:t,Xia Student:t', 'guard: XS and XT stay in W2');
select t.eq((select access_status::text from profiles where id = t.id('S3')), 'deactivated', 'guard: S3 still deactivated');

-- AC 3 / AC 7: S1 joins W2. Agreements and recovery code kept; the old switches are gone (defaults).
select t.login('S1');
select t.lives(format('select rejoin_workspace(%L)', t.code('W2')), 'AC 3: S1 joins W2');
select t.eq(coalesce(current_setting('sham.rejoining', true), ''), '', 'guard: the flag is cleared after the call');
select t.eq(pg_temp.err(format('update profiles set workspace_id = %L where id = auth.uid()', t.r('W3'))), '42501',
  'guard: after joining, S1 can''t move on by hand');
-- A waiting rejoiner still reads nothing of W2 and can't write in it.
select t.eq((select count(*) from workspaces)::int, 0, 'pending: reads no workspace');
select t.eq((select count(*) from general_messages)::int, 0, 'pending: reads no chat message of W2');
select t.ok(pg_temp.err($$insert into general_messages (author_id, body) values (auth.uid(), 'hi')$$) <> 'no error',
  'pending: can''t post in W2''s general chat');
reset role;
select t.eq((select count(*) from legal_agreements where user_id = t.id('S1'))::int, 1, 'AC 7: join keeps the legal agreement');
select t.eq((select code_hash from recovery_codes where user_id = t.id('S1')), 'hash-s1', 'AC 7: join keeps the recovery code');
select t.eq((select count(*) from notification_settings where user_id = t.id('S1'))::int, 0,
  'AC 7: notification switches start from the defaults (no row)');
select t.eq((select count(*) from net.requests where body ->> 'user_id' = t.id('S1')::text)::int, 1, 'AC 6: one notification');

-- AC 8: declined after joining: the status trigger doesn't fire again, and the account can't try another code.
select t.rlogin('XT');
select t.lives(format('select set_access_status(%L, ''rejected'')', t.id('S1')), 'AC 8: XT declines S1');
reset role;
select t.login('S1');
select t.eq(pg_temp.err(format('select rejoin_workspace(%L)', t.code('W3'))), '55000 | sham:workspace_already_member',
  'AC 8: declined, S1 can''t join another workspace');
reset role;
select t.eq((select count(*) from net.requests)::int, 1, 'AC 8: declining sends no new-account notification');

-- AC 5 / AC 7: S2 creates a workspace; agreement and recovery code kept.
select t.login('S2');
select t.lives($$select create_my_workspace('Sue school')$$, 'AC 5: S2 creates a workspace');
reset role;
select t.eq((select count(*) from legal_agreements where user_id = t.id('S2'))::int, 1, 'AC 7: create keeps the legal agreement');
select t.eq((select code_hash from recovery_codes where user_id = t.id('S2')), 'hash-s2', 'AC 7: create keeps the recovery code');
select t.eq((select count(*) from profiles p where p.workspace_id = (select workspace_id from profiles where id = t.id('S2')))::int, 1,
  'AC 5: the new workspace has exactly one member, its teacher');

-- Concurrency, two sessions (dblink, as the app's roles).
create function t.conn(name text, who text) returns void language plpgsql as $$
begin
  perform dblink_connect(name, format('dbname=%s host=%s user=postgres', current_database(),
    split_part(current_setting('unix_socket_directories'), ',', 1)));
  if who = 'service_role' then
    perform dblink_exec(name, 'set role service_role');
  else
    perform dblink_exec(name, format('set request.jwt.claims = %L',
      json_build_object('sub', coalesce(t.id(who), t.r(who)), 'role', 'authenticated')::text));
    perform dblink_exec(name, 'set role authenticated');
  end if;
end $$;
-- The backend pid of a connection.
create function t.pid(name text) returns int language sql as $$ select p from dblink(name, 'select pg_backend_pid()') as x(p int) $$;
-- Waits until the backend waits for a lock (true) or 5 seconds pass (false).
create function t.wait_lock(pid int) returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    if exists (select 1 from pg_stat_activity a where a.pid = wait_lock.pid and a.wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end $$;
-- The async query's result: 'ok' or its error message; also drains the connection.
create function t.result(name text) returns text language plpgsql as $$
declare v text; msg text;
begin
  select x.v into v from dblink_get_result(name, false) as x(v text);
  msg := dblink_error_message(name);
  perform * from dblink_get_result(name, false) as x(v text);
  return case when msg is null or msg = 'OK' then 'ok' else msg end;
end $$;

-- 1. W3 is being deleted (its teacher's delete_workspace() runs, not committed yet) when S3 taps Join with W3's code:
-- the join waits, then says the code is unknown; S3 stays deactivated.
select t.conn('del', 'service_role');
select t.conn('joiner', 'S3');
select t.pid('joiner') as joiner_pid \gset
select dblink_exec('del', 'begin');
select t.eq((select v from dblink('del', format('select delete_workspace(%L)::text', t.r('YT'))) as x(v text)), '', 'race 1: the deletion of W3 runs (not committed)');
select t.ok(dblink_send_query('joiner', format('select rejoin_workspace(%L)::text', t.code('W3'))) = 1, 'race 1: join sent');
select t.ok(t.wait_lock(:joiner_pid),
  'race 1: the join waits for the deletion');
select dblink_exec('del', 'commit');
select t.ok(t.result('joiner') like '%No workspace has this invite code.%', 'race 1: the join gets "No workspace has this invite code."');
select t.eq((select concat_ws(',', workspace_id is null, access_status) from profiles where id = t.id('S3')), 't,deactivated',
  'race 1: S3 is still deactivated');
select t.ok(not exists (select 1 from workspaces where id = t.r('W3')), 'race 1: W3 is gone');
select dblink_disconnect('del');
select dblink_disconnect('joiner');

-- 2. M's join to W4 runs first (not committed yet) when ZT deletes W4: the deletion waits, then finishes and
-- deactivates M again; no raw error, the constraint holds.
select t.conn('joiner', 'M');
select t.conn('del', 'service_role');
select t.pid('del') as del_pid \gset
select dblink_exec('joiner', 'begin');
select t.eq((select v from dblink('joiner', format('select rejoin_workspace(%L)::text', t.code('W4'))) as x(v text)), '', 'race 2: M joins W4 (not committed)');
select t.ok(dblink_send_query('del', format('select delete_workspace(%L)::text', t.r('ZT'))) = 1, 'race 2: deletion sent');
select t.ok(t.wait_lock(:del_pid),
  'race 2: the deletion waits for the join');
select dblink_exec('joiner', 'commit');
select t.eq(t.result('del'), 'ok', 'race 2: the deletion succeeds');
select t.eq((select concat_ws(',', workspace_id is null, access_status) from profiles where id = t.id('M')), 't,deactivated',
  'race 2: M is deactivated again (its new workspace is gone)');
select t.ok(not exists (select 1 from workspaces where id = t.r('W4')), 'race 2: W4 is gone');
select dblink_disconnect('joiner');
select dblink_disconnect('del');

-- 3. N on two devices: Join (not committed yet) and Create at the same time. Create waits, then gets AC 10.
select count(*) as before from workspaces \gset
select t.conn('dev1', 'N');
select t.conn('dev2', 'N');
select t.pid('dev2') as dev2_pid \gset
select dblink_exec('dev1', 'begin');
select t.eq((select v from dblink('dev1', format('select rejoin_workspace(%L)::text', t.code('W2'))) as x(v text)), '', 'race 3: device 1 joins W2 (not committed)');
select t.ok(dblink_send_query('dev2', 'select create_my_workspace(''Nina school'')::text') = 1, 'race 3: create sent');
select t.ok(t.wait_lock(:dev2_pid),
  'race 3: the create waits for the join');
select dblink_exec('dev1', 'commit');
select t.ok(t.result('dev2') like '%You already belong to a workspace.%', 'race 3: the create gets "You already belong to a workspace."');
select t.eq((select count(*) from workspaces)::int, :before, 'race 3: no workspace was created');
select t.eq((select concat_ws(',', workspace_id = t.r('W2'), role, access_status) from profiles where id = t.id('N')),
  't,student,pending', 'race 3: N is a waiting student of W2');
select t.eq((select count(*) from net.requests where body ->> 'user_id' = t.id('N')::text)::int, 1, 'race 3: one notification');
select dblink_disconnect('dev1');
select dblink_disconnect('dev2');

-- 4. M2 taps Create twice (a retry after a lost response, both in flight): exactly one workspace.
select t.conn('dev1', 'M2');
select t.conn('dev2', 'M2');
select t.pid('dev2') as dev2_pid \gset
select dblink_exec('dev1', 'begin');
select t.eq((select v from dblink('dev1', 'select create_my_workspace(''Mo school'')::text') as x(v text)), '', 'race 4: first create (not committed)');
select t.ok(dblink_send_query('dev2', 'select create_my_workspace(''Mo school'')::text') = 1, 'race 4: second create sent');
select t.ok(t.wait_lock(:dev2_pid),
  'race 4: the second create waits');
select dblink_exec('dev1', 'commit');
select t.ok(t.result('dev2') like '%You already belong to a workspace.%', 'race 4: the second create gets AC 10');
select t.eq((select count(*) from workspaces where name = 'Mo school')::int, 1, 'race 4: exactly one "Mo school"');
select dblink_disconnect('dev1');
select dblink_disconnect('dev2');

-- Data checks after everything.
select t.eq((select count(*) from profiles where (workspace_id is null) <> (access_status = 'deactivated'))::int, 0,
  'data: no workspace exactly when deactivated');
select t.eq((select count(*) from (select workspace_id from profiles where role = 'teacher' group by 1 having count(*) > 1) x)::int, 0,
  'data: one teacher per workspace');
