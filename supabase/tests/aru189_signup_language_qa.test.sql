-- ARU-189 QA: handle_new_user() (0080) against 0075, the cases the dev tests don't cover. Bad language values never
-- block a sign-up on either path, the admin exemptions and the workspace create / join rules are kept, the trigger only
-- writes the new account's own row, and re-applying 0080 changes nothing.
select t.seed();

create function pg_temp.u(who text) returns uuid language sql immutable as $$ select md5('qa189' || who)::uuid $$;
create function pg_temp.signup(who text, meta jsonb) returns text language plpgsql as $$
declare code text; msg text; hint text; result text := 'no error';
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u(who),
      'q' || left(md5(who), 20) || '@users.sham.invalid',
      '{"terms_version": 1}'::jsonb || jsonb_build_object('username', 'q' || left(md5(who), 20), 'full_name', 'QA ' || who) || meta);
  exception when others then
    get stacked diagnostics code = returned_sqlstate, msg = message_text, hint = pg_exception_hint;
    result := concat_ws(' | ', code, msg, hint);
  end;
  execute 'reset session authorization';
  return result;
end $$;
create function pg_temp.lang_of(who text) returns text language sql as $$
  select language from public.profiles where id = pg_temp.u(who) $$;
create function pg_temp.state_of(who text) returns text language sql as $$
  select p.role::text || '/' || p.access_status::text || '/' || coalesce(w.name, '-')
  from public.profiles p left join public.workspaces w on w.id = p.workspace_id where p.id = pg_temp.u(who) $$;

select code as sham_code from workspace_invite_codes where workspace = signup_workspace() \gset

-- Bad values never block the sign-up, on the create-workspace path too (teacher, approved, own workspace).
select t.eq(pg_temp.signup('c1', '{"workspace_name":"QA Create DE","language":"de"}'), 'no error', 'create + de: created');
select t.eq(pg_temp.lang_of('c1'), null::text, 'create + de: null');
select t.eq(pg_temp.state_of('c1'), 'teacher/approved/QA Create DE', 'create + de: teacher of the new workspace');
select t.eq(pg_temp.signup('c2', '{"workspace_name":"QA Create Arr","language":["ru"]}'), 'no error', 'create + array: created');
select t.eq(pg_temp.lang_of('c2'), null::text, 'create + array: null');
select t.eq(pg_temp.signup('c3', '{"workspace_name":"QA Create Bool","language":true}'), 'no error', 'create + boolean: created');
select t.eq(pg_temp.lang_of('c3'), null::text, 'create + boolean: null');
select t.eq(pg_temp.signup('c4', '{"workspace_name":"QA Create EN","language":"en"}'), 'no error', 'create + en: created');
select t.eq(pg_temp.lang_of('c4'), 'en', 'create + en: en');
select t.eq(pg_temp.state_of('c4'), 'teacher/approved/QA Create EN', 'create + en: teacher of the new workspace');

-- Join path (student, pending, the invite code's workspace): more bad values.
select t.eq(pg_temp.signup('j1', format('{"invite_code":"%s","language":"ru "}', :'sham_code')::jsonb), 'no error', 'join + trailing space: created');
select t.eq(pg_temp.lang_of('j1'), null::text, 'join + "ru ": null');
select t.eq(pg_temp.signup('j2', format('{"invite_code":"%s","language":"en-US"}', :'sham_code')::jsonb), 'no error', 'join + en-US: created');
select t.eq(pg_temp.lang_of('j2'), null::text, 'join + en-US: null');
select t.eq(pg_temp.signup('j3', format('{"invite_code":"%s","language":"%s"}', :'sham_code', repeat('r', 5000))::jsonb), 'no error',
  'join + a 5000-character value: created');
select t.eq(pg_temp.lang_of('j3'), null::text, 'join + a 5000-character value: null');
select t.eq(pg_temp.signup('j4', format('{"invite_code":"%s","language":"ru''; drop table profiles; --"}', :'sham_code')::jsonb),
  'no error', 'join + SQL-looking value: created');
select t.eq(pg_temp.lang_of('j4'), null::text, 'join + SQL-looking value: null');
select t.eq(pg_temp.signup('j5', format('{"invite_code":"%s","language":"ру"}', :'sham_code')::jsonb), 'no error', 'join + Cyrillic ру: created');
select t.eq(pg_temp.lang_of('j5'), null::text, 'join + Cyrillic ру: null');
select t.eq(pg_temp.state_of('j5'), 'student/pending/' || (select name from workspaces where id = signup_workspace()),
  'join + bad value: still a waiting student of the code''s workspace');

-- 0075 rules still refuse with a good language: the workspace and username errors are unchanged.
-- (0075: a missing or double choice is an older app or a direct Auth call: sham:signup_update_app.)
select t.eq(pg_temp.signup('e1', '{"language":"ru"}') like '%sham:signup_update_app', true,
  'no workspace choice: still refused, even with ru');
select t.eq(pg_temp.signup('e2', '{"workspace_name":"A","invite_code":"B","language":"ru"}') like '%sham:signup_update_app', true,
  'both workspace choices: still refused');
select t.eq(pg_temp.signup('e3', '{"workspace_name":"   ","language":"en"}') like '%sham:%', true, 'blank workspace name: still refused');
select t.eq(pg_temp.signup('e4', '{"invite_code":"ZZZZZZZZ","language":"de"}'), 'P0002 | No workspace has this invite code. | sham:invite_code_unknown',
  'wrong code + bad language: the code error, not a language one');
select t.eq(pg_temp.signup('e5', '{"workspace_name":"W5","username":"A!","language":"ru"}') like '%sham:%', true,
  'bad username: still refused, even with ru');
select t.eq(pg_temp.signup('e6', '{"workspace_name":"W6","full_name":"   ","language":"ru"}') like '%sham:%', true,
  'blank display name: still refused, even with ru');
select t.eq((select count(*) from auth.users where id in (pg_temp.u('e1'), pg_temp.u('e2'), pg_temp.u('e3'), pg_temp.u('e4'),
  pg_temp.u('e5'), pg_temp.u('e6'))), 0::bigint, 'refused sign-ups: no auth user');
select t.eq((select count(*) from profiles where id in (pg_temp.u('e1'), pg_temp.u('e4'), pg_temp.u('e6'))), 0::bigint,
  'refused sign-ups: no profile');
select t.eq((select count(*) from workspaces where name in ('W5', 'W6')), 0::bigint, 'refused sign-ups: no workspace left behind');

-- Admin exemptions (SQL Editor as postgres): no username / workspace / terms needed; a good language is saved, a bad one
-- never refuses.
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u('a1'), 'qa189a1@example.com', '{"full_name":"Admin RU","language":"ru"}');
select t.eq(pg_temp.lang_of('a1'), 'ru', 'admin insert with ru: saved');
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u('a2'), 'qa189a2@example.com', '{"full_name":"Admin bad","language":"xx"}');
select t.eq(pg_temp.lang_of('a2'), null::text, 'admin insert with a bad value: created, null');
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u('a3'), 'qa189a3@example.com', null);
select t.eq((select count(*) from profiles where id = pg_temp.u('a3')), 1::bigint, 'admin insert with no user data: created');
select t.eq(pg_temp.lang_of('a3'), null::text, 'admin insert with no user data: null');

-- The trigger writes only the new account's row: other accounts keep their language, and changing user data later
-- (auth.updateUser) doesn't touch profiles.language.
update profiles set language = 'en' where id = t.id('S1');
select t.eq(pg_temp.signup('o1', format('{"invite_code":"%s","language":"ru","id":"%s"}', :'sham_code', t.id('S1'))::jsonb), 'no error',
  'a sign-up naming another id in its user data: created');
select t.eq((select language from profiles where id = t.id('S1')), 'en', 'the other account''s language is unchanged');
select t.eq(pg_temp.lang_of('o1'), 'ru', 'the new account got its own language');
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"language":"en"}' where id = pg_temp.u('o1');
select t.eq(pg_temp.lang_of('o1'), 'ru', 'later user-data change: profiles.language unchanged');

-- 0080 can be applied again (create or replace) and keeps the revoke.
\ir ../migrations/0080_signup_language.sql
select t.eq(has_function_privilege('authenticated', 'handle_new_user()', 'execute'), false, 're-applied: execute still revoked (authenticated)');
select t.eq(has_function_privilege('anon', 'handle_new_user()', 'execute'), false, 're-applied: execute still revoked (anon)');
select t.eq((select count(*) from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass), 1::bigint,
  're-applied: still one sign-up trigger');
select t.eq(pg_temp.signup('r1', format('{"invite_code":"%s","language":"ru"}', :'sham_code')::jsonb), 'no error', 're-applied: sign-up works');
select t.eq(pg_temp.lang_of('r1'), 'ru', 're-applied: language saved');
