-- QA ARU-164: gaps in aru164_username_sign_in.test.sql. Display names made only of the spaces ARU-56 counts as blank
-- (no-break and other Unicode spaces, through a direct API sign-up), spaces around a username, letter case in the
-- address, look-alike domains, every 0060 rule with a valid username (both choices, unknown code, no orphan workspace
-- for a taken username), declined accounts, the other workspace's teacher, no function returning an email, and the
-- Auth address changing after sign-up (a signed-in user's email change goes through as supabase_auth_admin).
select t.seed();

create function pg_temp.u(who text) returns uuid language sql immutable as $$ select md5('aru164qa' || who)::uuid $$;
-- A sign-up as Supabase Auth makes it. errcode | hint, or 'ok'.
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
-- An Auth address change as Supabase Auth makes it (auth.updateUser({ email }) with Confirm email off applies it at
-- once, as supabase_auth_admin). The new address, or 'refused <errcode>'.
create function pg_temp.change_email(who text, email text) returns text language plpgsql as $$
declare result text;
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    update auth.users set email = change_email.email where id = pg_temp.u(who);
    select u.email into result from auth.users u where u.id = pg_temp.u(who);
  exception when others then
    result := 'refused ' || sqlstate;
  end;
  execute 'reset session authorization';
  return result;
end $$;
select set_config('t.code', (select c.code from workspace_invite_codes c join profiles p on p.workspace_id = c.workspace
  where p.id = t.id('T')), false);
create function t.qa_login_id(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.qa_login_id(uuid) to anon, authenticated;
create function pg_temp.join_meta(username text, name text default 'Dana') returns jsonb language sql as $$
  select jsonb_build_object('username', username, 'full_name', name, 'invite_code', current_setting('t.code')) $$;

-- AC 2 / 3: spaces around the username are trimmed; the address may arrive in any case.
select t.eq(pg_temp.signup('sp', 'spaced@users.sham.invalid', pg_temp.join_meta(E'  spaced\n', 'Sp')), 'ok',
  'AC2 spaces and a line break around the username are trimmed');
select t.eq((select username from usernames where user_id = pg_temp.u('sp')), 'spaced', 'AC2 saved trimmed');
select t.eq(pg_temp.signup('caps', 'CAPS.9@USERS.SHAM.INVALID', pg_temp.join_meta('Caps.9', 'Caps')), 'ok',
  'AC3 an upper-case address for the same username is accepted');
-- Note 1: only the exact internal domain counts.
select t.eq(pg_temp.signup('evil', 'evil1@users.sham.invalid.example.com', pg_temp.join_meta('evil1')),
  '22023 | sham:signup_email_mismatch', 'note 1 a look-alike domain is refused');
select t.eq(pg_temp.signup('sub', 'sub1@x.users.sham.invalid', pg_temp.join_meta('sub1')),
  '22023 | sham:signup_email_mismatch', 'note 1 a subdomain of the internal domain is refused');

-- 0060 rules still hold with a valid username.
select set_config('t.ws', (select count(*)::text from workspaces), false);
select t.eq(pg_temp.signup('both', 'both1@users.sham.invalid', jsonb_build_object('username', 'both1', 'full_name', 'B',
  'invite_code', current_setting('t.code'), 'workspace_name', 'X')), '22023 | sham:signup_update_app',
  '0060 both a workspace name and a code: refused');
select t.eq(pg_temp.signup('nocode', 'nocode1@users.sham.invalid', jsonb_build_object('username', 'nocode1',
  'full_name', 'N', 'invite_code', 'ZZZZ2222')), 'P0002 | sham:invite_code_unknown', '0060 unknown invite code: refused');
select t.eq(pg_temp.signup('neither', 'neither1@users.sham.invalid', jsonb_build_object('username', 'neither1',
  'full_name', 'N')), '22023 | sham:signup_update_app', '0060 neither choice: refused');
select t.eq(pg_temp.signup('w2t', 'w2.teacher@users.sham.invalid', jsonb_build_object('username', 'w2.teacher',
  'full_name', 'Second teacher', 'workspace_name', 'School B')), 'ok', 'create a second workspace');
select t.eq(pg_temp.signup('dup', 'w2.teacher@users.sham.invalid', jsonb_build_object('username', 'W2.Teacher',
  'full_name', 'Dup', 'workspace_name', 'School C')), '23505 | sham:username_taken',
  'AC4 a taken username creating a workspace is refused');
select t.eq((select count(*)::text from workspaces), (current_setting('t.ws')::int + 1)::text,
  'AC4 the refused create-workspace sign-up left no workspace behind');
select t.ok(not exists (select 1 from usernames where username in ('both1', 'nocode1', 'neither1')),
  '0060 refusals make no username row');

-- Access: a declined account reads only its own row; another workspace's teacher sees none of this one's requests.
update profiles set access_status = 'rejected' where id = pg_temp.u('caps');
select t.qa_login_id(pg_temp.u('caps'));
select t.eq((select string_agg(username, ',') from usernames), 'caps.9', 'access: a declined account reads its own row only');
select t.qa_login_id(pg_temp.u('w2t'));
select t.eq((select count(*) from access_requests() where username in ('spaced', 'caps.9')), 0::bigint,
  'AC11 the other workspace''s teacher doesn''t see these requests');
select t.eq((select count(*) from usernames), 1::bigint, 'access: the other teacher reads only their own row');
select t.login('T');
select t.eq((select count(*) from access_requests() where username = 'w2.teacher'), 0::bigint,
  'AC11 this workspace''s teacher doesn''t see the other workspace');
select t.eq((select string_agg(username, ',' order by username) from access_requests() where username in ('spaced', 'caps.9')),
  'caps.9,spaced', 'AC11 the teacher sees waiting and declined requests with their usernames');
reset role;

-- No signed-in or signed-out caller can test usernames through the helper.
select t.ok(not has_function_privilege('anon', 'username_is_valid(text)', 'execute')
  and not has_function_privilege('authenticated', 'username_is_valid(text)', 'execute'), 'username_is_valid is internal');
-- No function in public returns an email any more.
select t.eq((select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and pg_get_function_result(p.oid) ~* '\memail\M'), null::text,
  'no public function returns an email column');

-- AC 5 + ARU-56: a display name made only of no-break or other Unicode spaces is blank, as for Edit name.
select t.eq(pg_temp.signup('nb1', 'nbsp1@users.sham.invalid', pg_temp.join_meta('nbsp1', chr(160) || chr(160))),
  '23514 | sham:display_name_invalid', 'AC5 display name of no-break spaces is refused');
select t.eq(pg_temp.signup('nb2', 'nbsp2@users.sham.invalid', pg_temp.join_meta('nbsp2', chr(12288) || chr(8239))),
  '23514 | sham:display_name_invalid', 'AC5 display name of ideographic / narrow no-break spaces is refused');
select t.ok(not exists (select 1 from usernames where username in ('nbsp1', 'nbsp2')),
  'AC5 blank-looking display names make no username row');

-- The address stays tied to the username after sign-up. Supabase Auth applies a signed-in user's
-- auth.updateUser({ email }) at once when Confirm email is off; the database should refuse it for a username account,
-- or a real email gets stored (ARU-164's goal) and someone can take another username's address and sign in as it.
select t.ok(pg_temp.change_email('sp', 'real.person@gmail.com') like 'refused%',
  'address: a username account can''t switch its Auth address to a real email');
select t.ok(pg_temp.change_email('sp', 'freeuser@users.sham.invalid') like 'refused%',
  'address: a username account can''t take another username''s internal address');
