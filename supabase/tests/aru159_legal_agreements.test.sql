-- ARU-159: agreement to the Privacy Policy and Terms of Use. Rules under test:
-- supabase/migrations/0075_legal_agreements.sql (legal_agreements, handle_new_user() reading terms_version,
-- agree_to_terms()).
select t.seed();

-- A sign-up as Supabase Auth makes it: an insert into auth.users as supabase_auth_admin. Returns 'ok' or
-- 'SQLSTATE | hint'.
create function pg_temp.u(who text) returns uuid language sql immutable as $$ select md5('aru159' || who)::uuid $$;
create function pg_temp.signup(who text, meta jsonb) returns text language plpgsql as $$
declare code text; hint text; result text := 'ok';
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u(who), who || '@users.sham.invalid',
      jsonb_build_object('username', who, 'full_name', 'User ' || who, 'invite_code', current_setting('t.code')) || meta);
  exception when others then
    get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
    result := concat_ws(' | ', code, hint);
  end;
  execute 'reset session authorization';
  return result;
end $$;
create function pg_temp.login(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return concat_ws(' | ', code, hint);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select set_config('t.code', (select c.code from workspace_invite_codes c join profiles p on p.workspace_id = c.workspace
  where p.id = t.id('T')), false);

-- AC 5: a sign-up with a valid version records the agreement in the same step, at server time.
select t.eq(pg_temp.signup('agree1', '{"terms_version": 1}'), 'ok', 'AC5 sign-up with terms_version 1');
select t.eq((select count(*) from legal_agreements where user_id = pg_temp.u('agree1') and version = 1
  and agreed_at between now() - interval '1 minute' and now() + interval '1 minute'), 1::bigint,
  'AC5 one agreement, version 1, agreed now');
select t.eq(pg_temp.signup('agree2', '{"terms_version": "2"}'), 'ok', 'AC5 a whole number sent as text is accepted');
select t.eq((select version from legal_agreements where user_id = pg_temp.u('agree2')), 2, 'AC5 version 2 recorded');
select t.eq(pg_temp.signup('agree3', '{"terms_version": 1, "workspace_name": null}'), 'ok',
  'AC5 join with an invite code and a version');
select t.eq((select access_status::text from profiles where id = pg_temp.u('agree3')), 'pending',
  '0060 rules kept: a join is pending');

-- AC 5: without a valid version, refused and nothing created.
select t.eq(pg_temp.signup('none1', '{}'), '22023 | sham:signup_update_app', 'AC5 no terms_version refused');
select t.eq(pg_temp.signup('zero1', '{"terms_version": 0}'), '22023 | sham:signup_update_app', 'AC5 version 0 refused');
select t.eq(pg_temp.signup('neg1', '{"terms_version": -1}'), '22023 | sham:signup_update_app', 'AC5 version -1 refused');
select t.eq(pg_temp.signup('abc1', '{"terms_version": "abc"}'), '22023 | sham:signup_update_app', 'AC5 text refused');
select t.eq(pg_temp.signup('frac1', '{"terms_version": 1.5}'), '22023 | sham:signup_update_app', 'AC5 1.5 refused');
select t.eq(pg_temp.signup('nul1', '{"terms_version": null}'), '22023 | sham:signup_update_app', 'AC5 null refused');
select t.eq(pg_temp.signup('huge1', '{"terms_version": 99999999999}'), '22023 | sham:signup_update_app',
  'AC5 a number too large refused (no overflow error)');
select t.eq((select count(*) from auth.users where id in (pg_temp.u('none1'), pg_temp.u('zero1'), pg_temp.u('neg1'),
  pg_temp.u('abc1'), pg_temp.u('frac1'), pg_temp.u('nul1'), pg_temp.u('huge1'))), 0::bigint, 'AC5 no auth user created');
select t.eq((select count(*) from profiles where id in (pg_temp.u('none1'), pg_temp.u('zero1'), pg_temp.u('abc1'))),
  0::bigint, 'AC5 no profile created');
select t.eq((select count(*) from usernames where username in ('none1', 'zero1', 'abc1')), 0::bigint,
  'AC5 no username taken');
select t.eq((select count(*) from workspaces where name = 'Refused 159'), 0::bigint, 'AC5 before: no workspace');
select t.eq(pg_temp.signup('wsno1', '{"workspace_name": "Refused 159", "invite_code": null}'), '22023 | sham:signup_update_app',
  'AC5 create a workspace without a version refused');
select t.eq((select count(*) from workspaces where name = 'Refused 159'), 0::bigint, 'AC5 no workspace created');

-- 0067 rules still hold, with a version.
select t.eq(pg_temp.signup('bad..name', '{"terms_version": 1}'), '23514 | sham:username_invalid', '0067 username rule kept');
select t.ok(pg_temp.signup('agree1', '{"terms_version": 1}') like '23505%', 'an existing account can''t sign up again');

-- Admin (SQL Editor, postgres) may still add a user without a version (0060 exemption); no agreement then.
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u('adm'), 'adm@x.test', '{"full_name": "Admin made"}');
select t.ok(exists (select 1 from profiles where id = pg_temp.u('adm')), 'admin insert without terms_version works');
select t.eq((select count(*) from legal_agreements where user_id = pg_temp.u('adm')), 0::bigint, 'admin insert: no agreement');

-- Existing accounts (the fixture) have no agreement: the app asks them (AC 8).
select t.eq((select count(*) from legal_agreements where user_id in (t.id('T'), t.id('S1'))), 0::bigint,
  'existing accounts have no agreement');

-- Access: own rows only; nobody reads anyone else's (the teacher included).
select pg_temp.login('agree1');
select t.eq((select count(*) from legal_agreements), 1::bigint, 'a user reads only their own agreement');
reset role;
select t.login('T');
select t.eq((select count(*) from legal_agreements), 0::bigint, 'the teacher reads no one else''s agreements');
reset role;

-- No direct writes from the app.
select pg_temp.login('agree1');
select t.throws(format('insert into legal_agreements (user_id, version) values (%L, 5)', pg_temp.u('agree1')), '42501',
  'no direct insert');
select t.throws('update legal_agreements set version = 9', '42501', 'no direct update');
select t.throws('delete from legal_agreements', '42501', 'no direct delete');
reset role;

-- AC 9: agree_to_terms saves the caller's agreement at server time; a second call is a no-op.
select t.login('S1');
select t.eq(pg_temp.err('select agree_to_terms(1)'), 'ok', 'AC9 agree_to_terms(1)');
select t.eq(pg_temp.err('select agree_to_terms(1)'), 'ok', 'AC9 a second call is a no-op');
select t.eq((select count(*) from legal_agreements), 1::bigint, 'AC9 one row for S1');
select t.eq((select max(version) from legal_agreements), 1, 'AC9 S1 agreed to version 1');
select t.eq(pg_temp.err('select agree_to_terms(0)'), '22023 | sham:terms_version_invalid', 'version 0 refused');
select t.eq(pg_temp.err('select agree_to_terms(-3)'), '22023 | sham:terms_version_invalid', 'negative refused');
select t.eq(pg_temp.err('select agree_to_terms(null)'), '22023 | sham:terms_version_invalid', 'null refused');
select t.eq(pg_temp.err('select agree_to_terms(2)'), 'ok', 'a newer version');
select t.eq((select max(version) from legal_agreements), 2, 'latest version 2');
reset role;
select t.eq((select count(*) from legal_agreements where user_id = t.id('S1')), 2::bigint, 'S1 has two agreements');
select t.ok((select bool_and(agreed_at between now() - interval '1 minute' and now() + interval '1 minute')
  from legal_agreements where user_id = t.id('S1')), 'AC9 server time');

-- Any access status may agree (a waiting account).
select pg_temp.login('agree3');
select t.eq(pg_temp.err('select agree_to_terms(2)'), 'ok', 'a pending account can agree');
reset role;

-- Grants: anon can't call it or read the table; signed-in users can call it; handle_new_user stays closed.
select t.ok(not has_function_privilege('anon', 'public.agree_to_terms(integer)', 'execute'), 'anon: no agree_to_terms');
select t.ok(not has_function_privilege('public', 'public.agree_to_terms(integer)', 'execute'), 'public: no agree_to_terms');
select t.ok(has_function_privilege('authenticated', 'public.agree_to_terms(integer)', 'execute'),
  'authenticated: agree_to_terms');
select t.ok(not has_function_privilege('anon', 'public.handle_new_user()', 'execute'), 'anon: no handle_new_user');
select t.ok(not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  'authenticated: no handle_new_user');
select t.ok(not has_table_privilege('anon', 'public.legal_agreements', 'select'), 'anon: no select on legal_agreements');
select t.ok((select relrowsecurity from pg_class where oid = 'public.legal_agreements'::regclass), 'RLS on');
select t.login(null);
select t.throws('select agree_to_terms(1)', '42501', 'anon: agree_to_terms denied');
reset role;

-- Account deletion (ARU-75): agreements go with the profile.
select t.eq((select count(*) from legal_agreements where user_id = pg_temp.u('agree2')), 1::bigint, 'before delete: one agreement');
delete from profiles where id = pg_temp.u('agree2');
select t.eq((select count(*) from legal_agreements where user_id = pg_temp.u('agree2')), 0::bigint,
  'agreements cascade with the profile');
