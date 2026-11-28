-- ARU-181: Delete workspace, part 2. Rules under test: supabase/migrations/0079_rejoin_workspace.sql.
-- W1 is the fixture's workspace (t.seed(): teacher T, mentors M, N, M2, students S1-S3, courses A and B); its teacher
-- deletes it (ARU-180's delete_workspace()), so everyone else in it is deactivated. W2 has teacher XT, student XS, a
-- waiting account XP and a declined account XD. Deactivated accounts join W2 by its invite code or create their own.
select t.seed();
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

create function t.r(n text) returns uuid language sql immutable as $$ select md5('aru181' || n)::uuid $$;
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

-- New-account notifications are on (the Vault stand-in), so the join's call shows in net.requests.
insert into vault.decrypted_secrets values ('new_account_notify_url', 'https://x.test/new-account'), ('new_account_notify_secret', 's');

-- W2 (made as the admin) with its people.
insert into workspaces (id, name) values (t.r('W2'), 'Other school');
insert into auth.users (id, email, raw_user_meta_data) values
  (t.r('XT'), 'xt@x.test', '{"full_name":"Xena Teacher"}'),
  (t.r('XS'), 'xs@x.test', '{"full_name":"Xia Student"}'),
  (t.r('XP'), 'xp@x.test', '{"full_name":"Xan Pending"}'),
  (t.r('XD'), 'xd@x.test', '{"full_name":"Xu Declined"}');
update profiles set workspace_id = t.r('W2') where id in (t.r('XT'), t.r('XS'), t.r('XP'), t.r('XD'));
update profiles set access_status = 'approved' where id in (t.r('XT'), t.r('XS'));
update profiles set access_status = 'rejected' where id = t.r('XD');
update profiles set role = 'teacher' where id = t.r('XT');
create temp table w2code as select code from workspace_invite_codes where workspace = t.r('W2');
grant select on w2code to authenticated;

-- W1 is deleted (files first, as the Edge Function does).
delete from storage.objects;
set role service_role;
select delete_workspace(t.id('T'));
reset role;
select t.eq((select count(*) from profiles where access_status = 'deactivated')::int, 6,
  'setup: the six other accounts of W1 are deactivated');
update profiles set created_at = now() - interval '30 days' where id = t.id('S1');
delete from net.requests;

-- Access
select t.ok(not has_function_privilege('anon', 'rejoin_workspace(text)', 'execute')
  and not has_function_privilege('anon', 'create_my_workspace(text)', 'execute')
  and not has_function_privilege('public', 'rejoin_workspace(text)', 'execute')
  and has_function_privilege('authenticated', 'rejoin_workspace(text)', 'execute')
  and has_function_privilege('authenticated', 'create_my_workspace(text)', 'execute'),
  'access: both functions are for signed-in users only');
select t.ok(not has_function_privilege('authenticated', 'rejoin_lock_me()', 'execute'), 'access: the helper is internal');
select t.login(null);
select t.eq(pg_temp.err($$select rejoin_workspace('ABCD1234')$$), '42501', 'access: signed out can''t join');
select t.eq(pg_temp.err($$select create_my_workspace('X')$$), '42501', 'access: signed out can''t create');
reset role;

-- AC 10 / roles: approved, waiting and declined accounts are refused, nothing changes.
do $$
declare who text;
begin
  foreach who in array array['XT', 'XS', 'XP', 'XD'] loop
    perform t.rlogin(who);
    perform t.eq(pg_temp.err(format('select rejoin_workspace(%L)', (select code from w2code))), '55000 | sham:workspace_already_member',
      who || ': join refused, already in a workspace');
    perform t.eq(pg_temp.err($q$select create_my_workspace('Second school')$q$), '55000 | sham:workspace_already_member',
      who || ': create refused, already in a workspace');
    reset role;
  end loop;
end $$;
select t.eq((select count(*) from workspaces)::int, 1, 'AC 10: no workspace was created');
select t.eq((select string_agg(access_status::text, ',' order by full_name) from profiles where workspace_id = t.r('W2')),
  'pending,approved,approved,rejected', 'AC 10: W2''s accounts are unchanged');

-- AC 4: an unknown code.
select t.login('S1');
select t.eq(pg_temp.err($$select rejoin_workspace('ZZZZ9999')$$), 'P0002 | sham:invite_code_unknown', 'AC 4: unknown code');
select t.eq(pg_temp.err($$select rejoin_workspace(null)$$), 'P0002 | sham:invite_code_unknown', 'AC 4: no code');
reset role;
select t.eq((select access_status::text from profiles where id = t.id('S1')), 'deactivated', 'AC 4: nothing changed');

-- The guard: a deactivated account still can't move itself with a direct update, flag or not.
select t.login('S1');
select t.eq(pg_temp.err(format('update profiles set workspace_id = %L where id = auth.uid()', t.r('W2'))), '42501',
  'guard: a direct workspace change is refused');
select set_config('sham.rejoining', t.id('S1')::text, false);
select t.eq(pg_temp.err(format('update profiles set workspace_id = %L, access_status = ''pending'' where id = auth.uid()', t.r('W2'))), '42501',
  'guard: also with the flag set by hand');
select set_config('sham.rejoining', '', false);
reset role;
-- The guard itself (not only the column grants): with the flag for S1, an app update of S2's row is still refused.
create function pg_temp.move(who uuid, ws uuid) returns void language plpgsql security definer as $$
begin
  perform set_config('sham.rejoining', who::text, true);
  update profiles set workspace_id = ws, access_status = 'pending' where id = who;
end $$;
grant execute on function pg_temp.move(uuid, uuid) to authenticated;
select t.login('S1');
select t.eq(pg_temp.err(format('select pg_temp.move(%L, %L)', t.id('S2'), t.r('W2'))), '42501 | sham:workspace_locked',
  'guard: the flag works only for the caller''s own row');
reset role;
select t.eq((select access_status::text from profiles where id = t.id('S2')), 'deactivated', 'guard: S2 unchanged');

-- AC 3 / AC 6: S1 joins W2 with the code in lower case and spaces around it.
select t.login('S1');
select t.lives(format('select rejoin_workspace(%L)', '  ' || lower((select code from w2code)) || ' '), 'AC 3: S1 joins W2');
reset role;
select t.eq((select concat_ws(',', workspace_id = t.r('W2'), role, access_status, access_changed_by is null, access_changed_at > now() - interval '1 minute')
  from profiles where id = t.id('S1')), 't,student,pending,t,t', 'AC 3: S1 is a waiting student of W2');
select t.eq((select count(*) from net.requests where body ->> 'user_id' = t.id('S1')::text)::int, 1,
  'AC 6: one new-account notification queued');
set role service_role;
select t.eq((select user_id from new_account_notification(t.id('S1'))), t.r('XT'), 'AC 6: it goes to W2''s teacher');
reset role;
select t.rlogin('XT');
select t.ok(exists (select 1 from access_requests() where id = t.id('S1')), 'AC 6: W2''s teacher sees S1 under Requests');
reset role;
select t.ok((select created_at < now() - interval '29 days' from profiles where id = t.id('S1')), 'note 10: the original sign-up date stays');
-- AC 7: login data kept.
select t.ok(exists (select 1 from auth.users where id = t.id('S1')), 'AC 7: the Auth user is kept');

-- AC 9 / AC 10: a retry after a lost response, or Create on the other device.
select t.login('S1');
select t.eq(pg_temp.err(format('select rejoin_workspace(%L)', (select code from w2code))), '55000 | sham:workspace_already_member',
  'AC 9: a retry is refused');
select t.eq(pg_temp.err($$select create_my_workspace('Mine')$$), '55000 | sham:workspace_already_member',
  'AC 10: Create from the other device is refused');
reset role;
select t.eq((select count(*) from net.requests)::int, 1, 'AC 9: no second notification');
select t.eq((select count(*) from workspaces)::int, 1, 'AC 9: no workspace was created');

-- A pending rejoiner sees nothing of W2 but its own row.
select t.login('S1');
select t.eq((select count(*) from profiles)::int, 1, 'pending: reads only its own profile');
reset role;

-- AC 6 / AC 8: Accept and Decline work as for any request.
select t.rlogin('XT');
select t.lives(format('select set_access_status(%L, ''approved'')', t.id('S1')), 'AC 6: the teacher accepts S1');
reset role;
select t.eq((select access_status::text from profiles where id = t.id('S1')), 'approved', 'AC 6: S1 approved');

-- Edge case: a former mentor joins as a waiting student.
select t.login('M');
select t.lives(format('select rejoin_workspace(%L)', (select code from w2code)), 'edge: former mentor M joins');
reset role;
select t.eq((select role || ',' || access_status from profiles where id = t.id('M')), 'student,pending', 'edge: M is a waiting student');
select t.rlogin('XT');
select t.lives(format('select set_access_status(%L, ''rejected'')', t.id('M')), 'AC 8: the teacher declines M');
reset role;
select t.login('M');
select t.eq(pg_temp.err($$select create_my_workspace('Again')$$), '55000 | sham:workspace_already_member',
  'out of scope: a declined rejoiner can''t create or join again');
reset role;

-- AC 5: create.
select t.login('S2');
select t.eq(pg_temp.err($$select create_my_workspace(repeat('x', 81))$$), '23514 | sham:workspace_name_length', 'AC 5: 81 characters refused');
select t.eq(pg_temp.err($$select create_my_workspace('   ')$$), '23514 | sham:workspace_name_length', 'AC 5: only spaces refused');
select t.eq(pg_temp.err($$select create_my_workspace(null)$$), '23514 | sham:workspace_name_length', 'AC 5: no name refused');
reset role;
select t.eq((select count(*) from workspaces)::int, 1, 'AC 5: nothing created by a refused name');
select t.login('S2');
select t.lives($$select create_my_workspace('  New school ')$$, 'AC 5: S2 creates a workspace');
reset role;
select t.eq((select concat_ws(',', w.name, p.role, p.access_status, p.access_changed_by is null)
  from profiles p join workspaces w on w.id = p.workspace_id where p.id = t.id('S2')),
  'New school,teacher,approved,t', 'AC 5: S2 is the approved teacher of "New school"');
select t.login('S2');
select t.ok((select name = 'New school' and invite_code ~ '^[A-Z0-9]{8}$' from my_workspace_invite()),
  'AC 5: Manage roles shows the name and a new invite code');
select t.eq(pg_temp.err($$select create_my_workspace('Third')$$), '55000 | sham:workspace_already_member',
  'AC 10: the new teacher can''t create a second workspace');
reset role;
select t.eq((select count(*) from net.requests where body ->> 'user_id' = t.id('S2')::text)::int, 0, 'AC 5: creating sends no new-account notification');

-- AC 5: 80 characters and a name another workspace has are fine; a former mentor can become a teacher.
select t.login('N');
select t.lives(format('select create_my_workspace(%L)', repeat('n', 80)), 'AC 5: 80 characters');
reset role;
select t.login('M2');
select t.lives($$select create_my_workspace('Other school')$$, 'edge: the same name as another workspace');
reset role;
select t.eq((select role::text from profiles where id = t.id('M2')), 'teacher', 'edge: former mentor M2 is a teacher');

-- S3 joins S2's new workspace: its teacher gets the notification.
create temp table s2code as
  select c.code from workspace_invite_codes c join profiles p on p.workspace_id = c.workspace where p.id = t.id('S2');
grant select on s2code to authenticated;
select t.login('S3');
select t.lives(format('select rejoin_workspace(%L)', (select code from s2code)), 'S3 joins the new workspace');
reset role;
set role service_role;
select t.eq((select user_id from new_account_notification(t.id('S3'))), t.id('S2'), 'AC 6: the new workspace''s teacher is notified');
reset role;

-- Data checks.
select t.eq((select count(*) from profiles where (workspace_id is null) <> (access_status = 'deactivated'))::int, 0,
  'data: no workspace exactly when deactivated');
select t.eq((select count(*) from (select workspace_id from profiles where role = 'teacher' group by 1 having count(*) > 1) x)::int, 0,
  'data: one teacher per workspace');
select t.eq((select count(*) from workspaces w where not exists (select 1 from workspace_invite_codes c where c.workspace = w.id))::int, 0,
  'data: every workspace has an invite code');
