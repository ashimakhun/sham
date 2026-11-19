-- ARU-164: sign-up and sign-in with a username and a display name. Rules under test:
-- supabase/migrations/0067_username_sign_in.sql.
select t.seed();

-- A sign-up as Supabase Auth makes it: an insert into auth.users as supabase_auth_admin. errcode | hint, or 'ok'.
create function pg_temp.u(who text) returns uuid language sql immutable as $$ select md5('aru164' || who)::uuid $$;
create function pg_temp.signup(who text, email text, meta jsonb) returns text language plpgsql as $$
declare code text; hint text; result text := 'ok';
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u(who), email, meta);
  exception when others then
    get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
    result := concat_ws(' | ', code, hint);
  end;
  execute 'reset session authorization';
  return result;
end $$;
select set_config('t.code', (select c.code from workspace_invite_codes c join profiles p on p.workspace_id = c.workspace
  where p.id = t.id('T')), false);
create function t.login_id(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.login_id(uuid) to anon, authenticated;
create function pg_temp.join_meta(username text, name text default 'Dana') returns jsonb language sql as $$
  select jsonb_build_object('username', username, 'full_name', name, 'invite_code', current_setting('t.code')) $$;

-- AC 3: join with an invite code; capital letters saved in lower case.
select t.eq(pg_temp.signup('dana', 'dana_s@users.sham.invalid', pg_temp.join_meta('Dana_S', '  Dana  ')), 'ok',
  'AC3 join sign-up with username and display name');
select t.eq((select username from usernames where user_id = pg_temp.u('dana')), 'dana_s', 'AC2 username saved in lower case');
select t.eq((select full_name || '/' || role || '/' || access_status from profiles where id = pg_temp.u('dana')),
  'Dana/student/pending', 'AC3 display name trimmed; waiting student');
-- AC 3: create a workspace.
select t.eq(pg_temp.signup('head', 'head.1@users.sham.invalid',
  '{"username": "head.1", "full_name": "Head", "workspace_name": "School 164"}'), 'ok', 'AC3 create-workspace sign-up');
select t.eq((select role || '/' || access_status from profiles where id = pg_temp.u('head')), 'teacher/approved',
  'AC3 creator is the approved teacher');

-- AC 4: taken in any letter case (Auth's unique address answers first in production; the trigger also refuses).
select t.eq(pg_temp.signup('dana2', 'dana_s@users.sham.invalid', pg_temp.join_meta('DANA_S')), '23505 | sham:username_taken',
  'AC4 a taken username is refused');
select t.ok(not exists (select 1 from profiles where id = pg_temp.u('dana2')), 'AC4 no second profile');

-- AC 5: refusals create no account, profile, workspace or username row.
select set_config('t.ws', (select count(*)::text from workspaces), false);
select t.eq(pg_temp.signup('old', 'old@x.test', jsonb_build_object('full_name', 'Old', 'invite_code', current_setting('t.code'))),
  '22023 | sham:signup_update_app', 'AC5 no username (an older app)');
select t.eq(pg_temp.signup('bad' || x, x || '@users.sham.invalid', pg_temp.join_meta(x)), '23514 | sham:username_invalid',
  'AC5 invalid username refused: ' || x)
  from unnest(array['ab', repeat('a', 31), 'dana s', 'dana@x', 'дана', '_dana', 'dana.', '-dana', 'da..na']) as x;
select t.eq(pg_temp.signup('ok' || x, lower(x) || '@users.sham.invalid', pg_temp.join_meta(x)), 'ok',
  'AC2 valid username accepted: ' || x)
  from unnest(array['abc', repeat('b', 30), 'd.a-n_a', 'Zed9']) as x;
select t.eq(pg_temp.signup('mismatch', 'alice@users.sham.invalid', pg_temp.join_meta('bob')),
  '22023 | sham:signup_email_mismatch', 'AC5 / note 1 an address that doesn''t match the username');
select t.eq(pg_temp.signup('real', 'carol@gmail.com', pg_temp.join_meta('carol')),
  '22023 | sham:signup_email_mismatch', 'AC5 / note 1 a real email with a valid username');
select t.eq(pg_temp.signup('blank', 'blank1@users.sham.invalid', pg_temp.join_meta('blank1', '   ')),
  '23514 | sham:display_name_invalid', 'AC5 blank display name');
select t.eq(pg_temp.signup('long', 'long1@users.sham.invalid', pg_temp.join_meta('long1', repeat('n', 81))),
  '23514 | sham:display_name_invalid', 'AC5 display name over 80 characters');
select t.eq(pg_temp.signup('nonm', 'nonm1@users.sham.invalid',
  jsonb_build_object('username', 'nonm1', 'invite_code', current_setting('t.code'))),
  '23514 | sham:display_name_invalid', 'AC5 no display name: never the email');
select t.eq(pg_temp.signup('n80', 'n80x@users.sham.invalid', pg_temp.join_meta('n80x', repeat('n', 80))), 'ok',
  'AC5 80 characters accepted');
select t.ok(not exists (select 1 from profiles where id in (pg_temp.u('old'), pg_temp.u('mismatch'), pg_temp.u('real'),
  pg_temp.u('blank'), pg_temp.u('long'), pg_temp.u('nonm'))), 'AC5 refused sign-ups made no profile');
select t.ok(not exists (select 1 from usernames where username in ('bob', 'carol', 'blank1', 'long1', 'nonm1')),
  'AC5 refused sign-ups made no username row');
select t.eq((select count(*)::text from workspaces), current_setting('t.ws'), 'AC5 refused sign-ups made no workspace');

-- AC 5: an admin insert (SQL Editor) without user data still works, as in 0060, and doesn't use the email.
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u('adm'), 'adm@x.test', '{}');
select t.eq((select full_name from profiles where id = pg_temp.u('adm')), '', 'AC5 admin insert works; no email as name');
select t.ok(not exists (select 1 from usernames where user_id = pg_temp.u('adm')), 'admin insert: no username row');

-- Access: own row only, no writes.
select t.login_id(pg_temp.u('dana'));
select t.eq((select string_agg(username, ',') from usernames), 'dana_s', 'access: a waiting user reads only their own row');
select t.login('T');
select t.eq((select count(*) from usernames), 0::bigint, 'access: the teacher reads no one else''s row');
select t.throws($$insert into usernames (user_id, username) values (auth.uid(), 'tess')$$, '42501', 'access: no insert');
select t.throws($$update usernames set username = 'x' || username$$, '42501', 'access: no update');
select t.login_id(pg_temp.u('dana'));
select t.throws($$update usernames set username = 'other'$$, '42501', 'access: own row can''t be changed');
select t.throws($$delete from usernames$$, '42501', 'access: own row can''t be deleted');
select t.login(null);
select t.throws($$select * from usernames$$, '42501', 'access: anon reads nothing');

-- AC 11: access requests show the username, never an email.
reset role;
select t.eq(pg_get_function_result('access_requests()'::regprocedure),
  'TABLE(id uuid, full_name text, username text, created_at timestamp with time zone, access_status access_status)',
  'AC11 access_requests() returns username and no email');
select t.ok(not has_function_privilege('anon', 'access_requests()', 'execute'), 'AC11 anon can''t run access_requests()');
select t.ok(has_function_privilege('authenticated', 'access_requests()', 'execute'), 'AC11 signed-in users can');
select t.ok(not has_function_privilege('anon', 'handle_new_user()', 'execute')
  and not has_function_privilege('authenticated', 'handle_new_user()', 'execute'), 'handle_new_user grants stay revoked');
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u('legacy'), 'legacy@x.test', '{"full_name": "Lee"}');
select t.login('T');
select t.eq((select string_agg(full_name || ':' || coalesce(username, '-'), ',' order by created_at, id) from access_requests()
  where id in (pg_temp.u('dana'), pg_temp.u('legacy'))), 'Dana:dana_s,Lee:-', 'AC11 username, or nothing for a legacy account');
select t.login('M');
select t.throws($$select * from access_requests()$$, '42501', 'AC11 a mentor can''t list requests');

-- Note 10: deleting an account frees its username.
reset role;
delete from auth.users where id = pg_temp.u('dana');
select t.ok(not exists (select 1 from usernames where username = 'dana_s'), 'note 10 the username row goes with the account');
select t.eq(pg_temp.signup('dana3', 'dana_s@users.sham.invalid', pg_temp.join_meta('dana_s')), 'ok',
  'note 10 the username can sign up again');
