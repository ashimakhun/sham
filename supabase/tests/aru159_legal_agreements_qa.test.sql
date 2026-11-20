-- QA ARU-159: gaps in aru159_legal_agreements.test.sql. Sign-up (AC 5) with other kinds of bad terms_version, in both
-- workspace paths (create / join), with the 0060 / 0067 rules still in force; the agreement time is the sign-up's;
-- declined accounts and mentors can agree too (AC 9, any access status); nobody reads another account's agreement
-- (mentor, accountant, same workspace); table shape (unique, check, cascade) and grants; not in realtime.
select t.seed();

create function pg_temp.u(who text) returns uuid language sql immutable as $$ select md5('qa159' || who)::uuid $$;
-- A sign-up as Supabase Auth makes it, without a default workspace choice. Returns 'ok' or 'SQLSTATE | hint'.
create function pg_temp.signup(who text, meta jsonb) returns text language plpgsql as $$
declare code text; hint text; result text := 'ok';
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u(who), who || '@users.sham.invalid',
      jsonb_build_object('username', who, 'full_name', 'User ' || who) || meta);
  exception when others then
    get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
    result := concat_ws(' | ', code, hint);
  end;
  execute 'reset session authorization';
  return result;
end $$;
create function pg_temp.login(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
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
create function pg_temp.agreements(who uuid) returns bigint language sql as $$
  select count(*) from legal_agreements where user_id = who $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select set_config('t.code', (select c.code from workspace_invite_codes c join profiles p on p.workspace_id = c.workspace
  where p.id = t.id('T')), false);

-- AC 5, create a workspace: the new teacher has the agreement; without a version nothing is created.
select t.eq(pg_temp.signup('qa_owner', '{"workspace_name": "QA 159 school", "terms_version": 1}'), 'ok',
  'AC5 create a workspace with terms_version 1');
select t.eq((select role::text from profiles where id = pg_temp.u('qa_owner')), 'teacher', 'AC5 the creator is its teacher');
select t.eq(pg_temp.agreements(pg_temp.u('qa_owner')), 1::bigint, 'AC5 the creator''s agreement is recorded');
select t.eq(pg_temp.signup('qa_owner2', '{"workspace_name": "QA 159 refused"}'), '22023 | sham:signup_update_app',
  'AC5 create a workspace without terms_version is refused');
select t.eq((select count(*) from workspaces where name = 'QA 159 refused'), 0::bigint, 'AC5 refused: no workspace');
select t.eq((select count(*) from auth.users where id = pg_temp.u('qa_owner2')), 0::bigint, 'AC5 refused: no auth user');

-- AC 5, join with a code: no version → no profile, no username.
select t.eq(pg_temp.signup('qa_join0', jsonb_build_object('invite_code', current_setting('t.code'))),
  '22023 | sham:signup_update_app', 'AC5 join without terms_version is refused');
select t.eq((select count(*) from profiles where id = pg_temp.u('qa_join0')), 0::bigint, 'AC5 refused join: no profile');
select t.eq((select count(*) from usernames where username = 'qa_join0'), 0::bigint, 'AC5 refused join: no username');

-- AC 5: other values that are not a whole number >= 1.
select t.eq(pg_temp.signup('qa_bool', jsonb_build_object('invite_code', current_setting('t.code'), 'terms_version', true)),
  '22023 | sham:signup_update_app', 'AC5 true is refused');
select t.eq(pg_temp.signup('qa_arr', jsonb_build_object('invite_code', current_setting('t.code'), 'terms_version', '[1]'::jsonb)),
  '22023 | sham:signup_update_app', 'AC5 an array is refused');
select t.eq(pg_temp.signup('qa_obj', jsonb_build_object('invite_code', current_setting('t.code'), 'terms_version', '{"v":1}'::jsonb)),
  '22023 | sham:signup_update_app', 'AC5 an object is refused');
select t.eq(pg_temp.signup('qa_empty', jsonb_build_object('invite_code', current_setting('t.code'), 'terms_version', '')),
  '22023 | sham:signup_update_app', 'AC5 an empty text is refused');
select t.eq(pg_temp.signup('qa_exp', jsonb_build_object('invite_code', current_setting('t.code'), 'terms_version', '1e1')),
  '22023 | sham:signup_update_app', 'AC5 1e1 is refused');
select t.eq(pg_temp.signup('qa_plus', jsonb_build_object('invite_code', current_setting('t.code'), 'terms_version', '+1')),
  '22023 | sham:signup_update_app', 'AC5 +1 is refused');
select t.eq(pg_temp.signup('qa_onept0', jsonb_build_object('invite_code', current_setting('t.code'), 'terms_version', 1.0)),
  '22023 | sham:signup_update_app', 'AC5 1.0 is refused (not written as a whole number)');
select t.eq((select count(*) from profiles where id in (pg_temp.u('qa_bool'), pg_temp.u('qa_arr'), pg_temp.u('qa_obj'),
  pg_temp.u('qa_empty'), pg_temp.u('qa_exp'), pg_temp.u('qa_plus'), pg_temp.u('qa_onept0'))), 0::bigint,
  'AC5 none of the refused sign-ups made a profile');

-- 0060 / 0067 rules still refuse, even with a valid version, and leave no agreement behind.
select t.eq(pg_temp.signup('qa_both', jsonb_build_object('invite_code', current_setting('t.code'), 'workspace_name', 'X',
  'terms_version', 1)), '22023 | sham:signup_update_app', '0060 both workspace fields still refused');
select t.eq(pg_temp.signup('qa_badcode', '{"invite_code": "ZZZZ9999", "terms_version": 1}'), 'P0002 | sham:invite_code_unknown',
  '0060 unknown invite code still refused');
select t.eq(pg_temp.signup('qa_longws', jsonb_build_object('workspace_name', repeat('w', 81), 'terms_version', 1)),
  '23514 | sham:workspace_name_length', '0060 workspace name length still checked');
select t.eq(pg_temp.signup('qa_noname', jsonb_build_object('invite_code', current_setting('t.code'), 'full_name', '  ',
  'terms_version', 1)), '23514 | sham:display_name_invalid', '0067 blank display name still refused');
select t.eq(pg_temp.signup('qa_nouser', jsonb_build_object('invite_code', current_setting('t.code'), 'username', '',
  'terms_version', 1)), '22023 | sham:signup_update_app', '0067 missing username still refused');
select t.eq((select count(*) from legal_agreements where user_id in (pg_temp.u('qa_both'), pg_temp.u('qa_badcode'),
  pg_temp.u('qa_longws'), pg_temp.u('qa_noname'), pg_temp.u('qa_nouser'))), 0::bigint,
  'refused sign-ups leave no agreement');

-- AC 5: a join records the agreement at the sign-up's time; the account waits (ARU-43) as before.
select t.eq(pg_temp.signup('qa_join1', jsonb_build_object('invite_code', current_setting('t.code'), 'terms_version', 1)), 'ok',
  'AC5 join with terms_version 1');
select t.ok((select agreed_at between now() - interval '1 minute' and now() from legal_agreements
  where user_id = pg_temp.u('qa_join1')), 'AC5 agreed_at is the time of sign-up (server time)');
select t.eq((select access_status::text from profiles where id = pg_temp.u('qa_join1')), 'pending', 'AC5 the joiner waits');
select t.eq(pg_temp.signup('qa_spaces', jsonb_build_object('invite_code', current_setting('t.code'), 'terms_version', ' 1 ')),
  'ok', 'AC5 a version with spaces around it is read as 1');
select t.eq((select version from legal_agreements where user_id = pg_temp.u('qa_spaces')), 1, 'AC5 recorded as 1');

-- AC 9: a declined account can agree too (any access status); a mentor and an accountant can agree.
update profiles set access_status = 'rejected' where id = pg_temp.u('qa_join1');
update profiles set is_accountant = true where id = t.id('M2');
select pg_temp.login(pg_temp.u('qa_join1'));
select t.eq(pg_temp.err('select agree_to_terms(2)'), 'ok', 'AC9 a declined account can agree');
select t.eq((select max(version) from legal_agreements), 2, 'AC9 the declined account reads its latest version');
reset role;
select pg_temp.login(t.id('M'));
select t.eq(pg_temp.err('select agree_to_terms(1)'), 'ok', 'AC9 a mentor can agree');
reset role;
select pg_temp.login(t.id('M2'));
select t.eq(pg_temp.err('select agree_to_terms(1)'), 'ok', 'AC9 an accountant can agree');
-- Read agreements: own only. M2 (accountant) and M (mentor of S1) see only their own rows.
select t.eq((select count(*) from legal_agreements), 1::bigint, 'access: the accountant reads only their own agreement');
select t.eq((select count(*) from legal_agreements where user_id <> t.id('M2')), 0::bigint,
  'access: the accountant reads no one else''s agreement');
reset role;
select pg_temp.login(t.id('M'));
select t.eq((select count(*) from legal_agreements where user_id <> t.id('M')), 0::bigint,
  'access: a mentor reads no one else''s agreement (not even a student''s)');
reset role;
-- The new teacher of another workspace doesn't see agreements of their own new members' workspace either.
select pg_temp.login(pg_temp.u('qa_owner'));
select t.eq((select count(*) from legal_agreements), 1::bigint, 'access: a teacher reads only their own agreement');
-- No direct write, even of one's own row with a valid version, and not through update of another's row.
select t.throws(format('insert into legal_agreements (user_id, version) values (%L, 3)', pg_temp.u('qa_owner')), '42501',
  'access: no direct insert of an own row');
reset role;
-- A student cannot agree on behalf of someone else: agree_to_terms has no user argument.
select t.eq((select count(*) from pg_proc where proname = 'agree_to_terms'), 1::bigint, 'one agree_to_terms function');
select t.eq((select pronargs::int from pg_proc where proname = 'agree_to_terms'), 1, 'agree_to_terms takes only the version');
select t.ok((select prosecdef from pg_proc where proname = 'agree_to_terms'), 'agree_to_terms is security definer');
select t.ok((select proconfig::text like '%search_path=public%' from pg_proc where proname = 'agree_to_terms'),
  'agree_to_terms sets search_path = public');

-- Table shape: unique (user_id, version), version >= 1, cascade with the profile, defaults.
select t.throws(format('insert into legal_agreements (user_id, version) values (%L, 1)', pg_temp.u('qa_owner')), '23505',
  'unique (user_id, version)');
select t.throws(format('insert into legal_agreements (user_id, version) values (%L, 0)', pg_temp.u('qa_owner')), '23514',
  'check version >= 1');
select t.throws(format('insert into legal_agreements (user_id, version) values (%L, 3)', gen_random_uuid()), '23503',
  'user_id must be a profile');
select t.eq((select c.confdeltype::text from pg_constraint c where c.conrelid = 'public.legal_agreements'::regclass
  and c.contype = 'f'), 'c', 'agreements cascade on profile delete');
select t.ok((select attnotnull from pg_attribute where attrelid = 'legal_agreements'::regclass and attname = 'agreed_at'),
  'agreed_at not null');

-- Grants: authenticated may only select; anon nothing.
select t.ok(not has_table_privilege('authenticated', 'public.legal_agreements', 'insert'), 'authenticated: no insert');
select t.ok(not has_table_privilege('authenticated', 'public.legal_agreements', 'update'), 'authenticated: no update');
select t.ok(not has_table_privilege('authenticated', 'public.legal_agreements', 'delete'), 'authenticated: no delete');
select t.ok(not has_table_privilege('anon', 'public.legal_agreements', 'insert'), 'anon: no insert');
select t.ok(not exists (select 1 from pg_policies where tablename = 'legal_agreements' and cmd <> 'SELECT'),
  'only a select policy');
-- Not needed in realtime (test design: data checks).
select t.ok(not exists (select 1 from pg_publication_tables where tablename = 'legal_agreements'),
  'legal_agreements is not in the realtime publication');

-- Account deletion through Auth (ARU-75 deletes the auth user): the agreements go too.
select t.eq(pg_temp.agreements(t.id('M2')), 1::bigint, 'before delete: the accountant has an agreement');
delete from auth.users where id = t.id('M2');
select t.eq(pg_temp.agreements(t.id('M2')), 0::bigint, 'ARU-75 deleting the account removes its agreements');
