-- ARU-189: the language picked on the Create account form is saved with the new account. Rules under test:
-- supabase/migrations/0080_signup_language.sql (handle_new_user(), every 0075 rule kept).
select t.seed();

-- A sign-up as Supabase Auth makes it: an insert into auth.users as supabase_auth_admin (as aru146 / aru159).
create function pg_temp.signup(who text, meta jsonb) returns text language plpgsql as $$
declare code text; msg text; hint text; result text := 'no error';
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (md5('aru189' || who)::uuid,
      'u' || left(md5(who), 20) || '@users.sham.invalid',
      '{"terms_version": 1}'::jsonb || jsonb_build_object('username', 'u' || left(md5(who), 20), 'full_name', 'User ' || who) || meta);
  exception when others then
    get stacked diagnostics code = returned_sqlstate, msg = message_text, hint = pg_exception_hint;
    result := concat_ws(' | ', code, msg, hint);
  end;
  execute 'reset session authorization';
  return result;
end $$;
create function pg_temp.u(who text) returns uuid language sql immutable as $$ select md5('aru189' || who)::uuid $$;
create function pg_temp.lang_of(who text) returns text language sql as $$
  select language from public.profiles where id = pg_temp.u(who) $$;
create function pg_temp.login(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select code as sham_code from workspace_invite_codes where workspace = signup_workspace() \gset

-- AC 5: create-workspace path (teacher, approved) with 'ru'.
select t.eq(pg_temp.signup('t1', '{"workspace_name":"School RU","language":"ru"}'), 'no error', 'AC5 teacher sign-up with ru');
select t.eq(pg_temp.lang_of('t1'), 'ru', 'AC5 teacher: profiles.language = ru');
select t.eq((select role::text || '/' || access_status::text from profiles where id = pg_temp.u('t1')), 'teacher/approved',
  'AC5 teacher: still teacher/approved');
-- AC 5: invite-code path (student, pending) with 'ru' and with 'en'.
select t.eq(pg_temp.signup('s1', format('{"invite_code":"%s","language":"ru"}', :'sham_code')::jsonb), 'no error',
  'AC5 student sign-up with ru');
select t.eq(pg_temp.lang_of('s1'), 'ru', 'AC5 student: profiles.language = ru');
select t.eq((select role::text || '/' || access_status::text from profiles where id = pg_temp.u('s1')), 'student/pending',
  'AC5 student: still student/pending');
select t.eq(pg_temp.signup('s2', format('{"invite_code":"%s","language":"en"}', :'sham_code')::jsonb), 'no error',
  'AC5 student sign-up with en');
select t.eq(pg_temp.lang_of('s2'), 'en', 'AC5 student: profiles.language = en');

-- AC 7 / Roles and access: no value or any other value is ignored (null) and the account is still created.
select t.eq(pg_temp.signup('n0', format('{"invite_code":"%s"}', :'sham_code')::jsonb), 'no error', 'AC7 no language key: created');
select t.eq(pg_temp.lang_of('n0'), null::text, 'AC7 no language key: null');
select t.eq(pg_temp.signup('n1', format('{"invite_code":"%s","language":"de"}', :'sham_code')::jsonb), 'no error', 'de: created');
select t.eq(pg_temp.lang_of('n1'), null::text, 'de: null');
select t.eq(pg_temp.signup('n2', format('{"invite_code":"%s","language":""}', :'sham_code')::jsonb), 'no error', 'empty: created');
select t.eq(pg_temp.lang_of('n2'), null::text, 'empty: null');
select t.eq(pg_temp.signup('n3', format('{"invite_code":"%s","language":"RU"}', :'sham_code')::jsonb), 'no error', 'RU: created');
select t.eq(pg_temp.lang_of('n3'), null::text, 'RU (capitals): null');
select t.eq(pg_temp.signup('n4', format('{"invite_code":"%s","language":" ru"}', :'sham_code')::jsonb), 'no error', 'space: created');
select t.eq(pg_temp.lang_of('n4'), null::text, 'leading space: null');
select t.eq(pg_temp.signup('n5', format('{"invite_code":"%s","language":5}', :'sham_code')::jsonb), 'no error', 'number: created');
select t.eq(pg_temp.lang_of('n5'), null::text, 'a number: null');
select t.eq(pg_temp.signup('n6', format('{"invite_code":"%s","language":null}', :'sham_code')::jsonb), 'no error', 'JSON null: created');
select t.eq(pg_temp.lang_of('n6'), null::text, 'JSON null: null');
select t.eq(pg_temp.signup('n7', '{"workspace_name":"School X","language":{"x":1}}'), 'no error', 'object: created');
select t.eq(pg_temp.lang_of('n7'), null::text, 'an object: null');

-- AC 8: a refused sign-up with a language creates nothing.
select t.eq(pg_temp.signup('f1', '{"invite_code":"ZZZZZZZZ","language":"ru"}'),
  'P0002 | No workspace has this invite code. | sham:invite_code_unknown', 'AC8 wrong invite code still refused');
select t.eq((select count(*) from auth.users where id = pg_temp.u('f1')), 0::bigint, 'AC8 no auth user');
select t.eq((select count(*) from profiles where id = pg_temp.u('f1')), 0::bigint, 'AC8 no profile');
-- Another person (new id and address) who picks t1's username.
select t.eq(pg_temp.signup('f2', jsonb_build_object('username', 'u' || left(md5('t1'), 20), 'workspace_name', 'Again', 'language', 'ru'))
  like '%sham:%', true, 'AC8 taken username (or its address) still refused');
select t.eq((select count(*) from profiles where id = pg_temp.u('f2')), 0::bigint, 'AC8 no profile for the taken username');

-- 0075 rules kept: the agreement, the username, the display name, the missing terms version.
select t.eq((select version from legal_agreements where user_id = pg_temp.u('s1')), 1, '0075 the agreement row is saved');
select t.eq((select count(*) from usernames where user_id = pg_temp.u('s1')), 1::bigint, '0075 the username row is saved');
select t.eq((select full_name from profiles where id = pg_temp.u('s1')), 'User s1', '0075 the display name is saved');
select t.eq((select array_agg(user_id) from new_account_notification(pg_temp.u('s1'))), array[t.id('T')],
  '0044 the teacher is told about the new account');
create function pg_temp.signup_no_terms() returns text language plpgsql as $$
declare hint text; result text := 'no error';
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (md5('aru189nt')::uuid, 'unoterms189@users.sham.invalid',
      jsonb_build_object('username', 'unoterms189', 'full_name', 'No Terms', 'workspace_name', 'W', 'language', 'ru'));
  exception when others then
    get stacked diagnostics hint = pg_exception_hint;
    result := hint;
  end;
  execute 'reset session authorization';
  return result;
end $$;
select t.eq(pg_temp.signup_no_terms(), 'sham:signup_update_app', '0075 no terms_version: still refused, even with a language');

-- Admin insert (SQL Editor) still works without a username or a language (0060).
insert into auth.users (id, email, raw_user_meta_data) values (md5('aru189admin')::uuid, 'admin189@example.com', '{"full_name":"Admin made"}');
select t.eq((select language from profiles where id = md5('aru189admin')::uuid), null::text, 'admin insert: created, language null');

-- Access: the pending student still can't update their own profile (policy unchanged, 0078).
select pg_temp.login('s2');
create function pg_temp.try_update() returns text language plpgsql as $$
declare n bigint;
begin
  update public.profiles set language = 'ru' where id = pg_temp.u('s2');
  get diagnostics n = row_count;
  return 'updated ' || n;
exception when others then
  return 'refused ' || sqlstate;
end $$;
select t.eq(pg_temp.try_update() in ('refused 42501', 'updated 0'), true, 'pending student: own profile update refused');
reset role;
select t.eq(pg_temp.lang_of('s2'), 'en', 'pending student: language unchanged');

-- Only its trigger runs handle_new_user(); existing profiles untouched.
select t.eq(has_function_privilege('authenticated', 'handle_new_user()', 'execute'), false, 'execute revoked from authenticated');
select t.eq(has_function_privilege('anon', 'handle_new_user()', 'execute'), false, 'execute revoked from anon');
select t.eq((select language from profiles where id = t.id('S1')), null::text, 'existing profiles: language unchanged');
