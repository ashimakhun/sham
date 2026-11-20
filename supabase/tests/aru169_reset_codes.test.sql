-- ARU-169: the teacher's reset codes (supabase/migrations/0074_reset_codes.sql).
select t.seed();
-- S1, S2, M have usernames; S3 is an older account without one; T has one too.
insert into usernames (user_id, username) values
  (t.id('S1'), 'sam'), (t.id('S2'), 'sue'), (t.id('M'), 'max'), (t.id('T'), 'tess');
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
create temp table codes (k text primary key, v text, exp timestamptz);
grant all on codes to authenticated, anon, service_role;

-- What a statement raises: errcode | hint (or 'no error').
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return code || ' | ' || coalesce(hint, '');
end $$;
grant execute on function pg_temp.err(text) to authenticated, anon, service_role;

-- Table: no app access.
select t.ok((select relrowsecurity from pg_class where oid = 'public.reset_codes'::regclass), 'reset_codes has RLS on');
select t.ok(not exists (select 1 from pg_policies where tablename = 'reset_codes'), 'no policies on reset_codes');
select t.ok(not has_table_privilege(r, 'reset_codes', p), r || ' has no ' || p || ' on reset_codes')
  from unnest(array['anon', 'authenticated']) r, unnest(array['insert', 'update', 'delete']) p;
select t.ok(not has_table_privilege('anon', 'reset_codes', 'select'), 'anon has no select on reset_codes');

-- AC 9 / AC 10: function access.
select t.ok(not has_function_privilege('anon', f, 'execute'), 'anon cannot execute ' || f)
  from unnest(array['make_reset_code(uuid)', 'workspace_usernames()']) f;
select t.ok(has_function_privilege('authenticated', f, 'execute'), 'authenticated can execute ' || f)
  from unnest(array['make_reset_code(uuid)', 'workspace_usernames()']) f;
select t.ok((select bool_and(prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=public'))
  from pg_proc where proname in ('make_reset_code', 'workspace_usernames')), 'security definer with search_path = public');

-- AC 9: refusals, in order, each leaving reset_codes unchanged.
select t.login('M');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('S1'))), '42501 | sham:only_teacher_reset_code',
  'a mentor can''t make a code');
reset role;
select t.login('S2');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('S1'))), '42501 | sham:only_teacher_reset_code',
  'a student can''t make a code');
reset role;
select t.login('T');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('T'))), '42501 | sham:reset_code_students_mentors',
  'the teacher can''t make one for themselves');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', gen_random_uuid())), 'P0002 | sham:user_not_found',
  'an account that doesn''t exist');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('S3'))), '23514 | sham:reset_code_no_username',
  'an account without a username');
reset role;
-- Another workspace.
insert into workspaces (name) values ('Other school');
update profiles set workspace_id = (select id from workspaces where name = 'Other school') where id = t.id('S2');
select t.login('T');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('S2'))), 'P0002 | sham:user_not_found',
  'a student of another workspace is not found');
reset role;
update profiles set workspace_id = (select workspace_id from profiles where id = t.id('T')) where id = t.id('S2');
-- Waiting and declined.
update profiles set access_status = 'pending' where id = t.id('S2');
select t.login('T');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('S2'))), '23514 | sham:accept_first',
  'a waiting account: accept first');
reset role;
update profiles set access_status = 'rejected' where id = t.id('S2');
select t.login('T');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('S2'))), '23514 | sham:accept_first',
  'a declined account: accept first');
reset role;
update profiles set access_status = 'approved' where id = t.id('S2');
select t.eq((select count(*) from reset_codes), 0::bigint, 'no refusal made a code');

-- AC 9: the code, its expiry and only the hash.
select t.login('T');
insert into codes select 'a', code, expires_at from make_reset_code(t.id('S1'));
reset role;
select t.ok((select v from codes where k = 'a') ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){3}$',
  'the code has part 1''s format');
select t.ok((select abs(extract(epoch from (exp - (now() + interval '24 hours')))) < 5 from codes where k = 'a'),
  'valid for 24 hours (server time)');
select t.ok((select code_hash = recovery_code_hash((select v from codes where k = 'a')) and created_by = t.id('T')
  from reset_codes where user_id = t.id('S1')), 'only the hash is stored, with who made it');
select t.ok(position(replace((select v from codes where k = 'a'), '-', '') in
  (select r::text from reset_codes r where user_id = t.id('S1'))) = 0, 'the plain code appears nowhere in the row');
-- Nobody in the app reads it, the teacher included.
select t.login('T');
select t.eq((select count(*) from reset_codes), 0::bigint, 'the teacher reads no reset_codes row');
select t.throws('delete from reset_codes', '42501', 'authenticated cannot delete reset_codes');
reset role;

-- A mentor (accountant) works too.
update profiles set is_accountant = true where id = t.id('M');
select t.login('T');
select t.lives(format('select make_reset_code(%L)', t.id('M')), 'a code for a mentor who is an accountant');
reset role;

-- AC 5: a second code replaces the first.
select t.login('T');
insert into codes select 'b', code, expires_at from make_reset_code(t.id('S1'));
reset role;
select t.eq((select count(*) from reset_codes where user_id = t.id('S1')), 1::bigint, 'one code per person');
set role service_role;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'a'))), 'wrong',
  'AC 5: the replaced code is refused like a wrong one');
select t.eq((select result from recovery_check('sam', lower((select v from codes where k = 'b')))), 'ok',
  'the newest code works, typed loosely');
select t.eq((select user_id from recovery_check('sam', (select v from codes where k = 'b'))), t.id('S1'), 'for S1');
reset role;
-- Edge: role change keeps it valid.
update profiles set role = 'mentor' where id = t.id('S1');
set role service_role;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'b'))), 'ok',
  'a role change keeps the code valid');
reset role;
update profiles set role = 'student' where id = t.id('S1');

-- AC 7: another username.
set role service_role;
select t.eq((select result from recovery_check('sue', (select v from codes where k = 'b'))), 'wrong',
  'S1''s code with another username is refused');
reset role;
select t.eq((select failures from recovery_attempts where username = 'sue'), 1, 'and counted');

-- AC 6: success deletes both codes (the old recovery code, saved, too).
insert into recovery_codes (user_id, code_hash, saved_at) values (t.id('S1'), recovery_code_hash('OLDC-ODEO-LDCO-DEAA'), now());
set role service_role;
select recovery_finish(t.id('S1'));
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'b'))), 'wrong',
  'AC 6: a used reset code is refused');
select t.eq((select result from recovery_check('sam', 'OLDC-ODEO-LDCO-DEAA')), 'wrong',
  'AC 6: the old recovery code is refused too');
reset role;
select t.ok(not exists (select 1 from reset_codes where user_id = t.id('S1')), 'no reset code left');
select t.ok(not exists (select 1 from recovery_codes where user_id = t.id('S1')), 'no recovery code left');
delete from recovery_attempts;

-- AC 7: an expired code is refused and counted.
select t.login('T');
insert into codes select 'c', code, expires_at from make_reset_code(t.id('S1'));
reset role;
update reset_codes set expires_at = now() - interval '1 second' where user_id = t.id('S1');
set role service_role;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'c'))), 'wrong',
  'an expired code is refused');
reset role;
select t.eq((select failures from recovery_attempts where username = 'sam'), 1, 'counted once');

-- AC 7: shared lock: 5 failures mixed across kinds, then a valid reset code is refused.
select t.login('T');
insert into codes select 'd', code, expires_at from make_reset_code(t.id('S1'));
reset role;
set role service_role;
select recovery_check('sam', 'AAAA-AAAA-AAAA-AAAA') from generate_series(1, 3);
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'c'))), 'wrong', '5th failure');
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'd'))), 'locked',
  'during the lock a valid reset code is refused');
reset role;
select t.ok(exists (select 1 from reset_codes where user_id = t.id('S1')), 'nothing changed: the code is still there');
update recovery_attempts set locked_until = now() - interval '1 second';
set role service_role;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'd'))), 'ok', 'after the lock: ok');
reset role;

-- AC 8: recovering with the recovery code ends a pending reset code.
select t.login('T');
insert into codes select 'e', code, expires_at from make_reset_code(t.id('S1'));
reset role;
insert into recovery_codes (user_id, code_hash, saved_at) values (t.id('S1'), recovery_code_hash('KEEP-KEEP-KEEP-KEEP'), now())
  on conflict (user_id) do update set code_hash = excluded.code_hash;
set role service_role;
select t.eq((select result from recovery_check('sam', 'KEEP-KEEP-KEEP-KEEP')), 'ok', 'own recovery code works');
select recovery_finish(t.id('S1'));
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'e'))), 'wrong',
  'AC 8: the pending reset code stopped working');
reset role;

-- AC 10: usernames for the teacher only, accepted accounts of their workspace only.
update profiles set access_status = 'pending' where id = t.id('S2');
select t.login('T');
select t.eq((select string_agg(username, ',' order by username) from workspace_usernames()), 'max,sam,tess',
  'the teacher gets accepted accounts'' usernames (not a waiting one)');
reset role;
update profiles set access_status = 'approved' where id = t.id('S2');
update profiles set workspace_id = (select id from workspaces where name = 'Other school') where id = t.id('M');
select t.login('T');
select t.eq((select string_agg(username, ',' order by username) from workspace_usernames()), 'sam,sue,tess',
  'another workspace''s accounts are left out');
reset role;
select t.login('S1');
select t.eq((select count(*) from workspace_usernames()), 0::bigint, 'a student gets no usernames');
select t.eq((select count(*) from usernames), 1::bigint, 'a student still reads only their own usernames row');
reset role;
select t.login('N');
select t.eq((select count(*) from workspace_usernames()), 0::bigint, 'a mentor gets no usernames');
reset role;

-- Edge: deleting the account removes its reset code.
select t.login('T');
select make_reset_code(t.id('S2'));
reset role;
delete from auth.users where id = t.id('S2');
select t.ok(not exists (select 1 from reset_codes where user_id = t.id('S2')), 'the reset code goes with the account');
