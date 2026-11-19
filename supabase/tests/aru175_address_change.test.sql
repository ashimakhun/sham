-- ARU-175 (ARU-164 AC 14): the Auth address can't change after sign-up except to the account's own internal address.
-- Rules under test: supabase/migrations/0067_username_sign_in.sql, part 4. Case numbers follow the analysis comment.
select t.seed();

create function pg_temp.u(who text) returns uuid language sql immutable as $$ select md5('aru175' || who)::uuid $$;
select set_config('t.code', (select c.code from workspace_invite_codes c join profiles p on p.workspace_id = c.workspace
  where p.id = t.id('T')), false);
-- As Supabase Auth: a sign-up, and an address change (auth.updateUser({ email }) with Confirm email off).
create function pg_temp.signup(who text, uname text) returns void language plpgsql as $$
begin
  execute 'set session authorization supabase_auth_admin';
  insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u(who), uname || '@users.sham.invalid',
    jsonb_build_object('username', uname, 'full_name', 'User ' || who, 'invite_code', current_setting('t.code')));
  execute 'reset session authorization';
end $$;
create function pg_temp.change(id uuid, email text) returns text language plpgsql as $$
declare code text; hint text; result text;
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    update auth.users set email = change.email where auth.users.id = change.id;
    select u.email into result from auth.users u where u.id = change.id;
  exception when others then
    get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
    result := concat_ws(' | ', code, hint);
  end;
  execute 'reset session authorization';
  return result;
end $$;
create function pg_temp.addr(who uuid) returns text language sql as $$ select email from auth.users where auth.users.id = who $$;

select pg_temp.signup('sp', 'spaced');
select pg_temp.signup('other', 'other1');
-- An older account: email, no usernames row (an admin insert, as before ARU-164).
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u('old'), 'old@x.test', '{"full_name": "Old"}');

-- 1–3: a username account can't move to a real email or another username's address.
select t.eq(pg_temp.change(pg_temp.u('sp'), 'real.person@gmail.com'), '42501 | sham:address_change_refused',
  '1 username account → real email: refused');
select t.eq(pg_temp.change(pg_temp.u('sp'), 'freeuser@users.sham.invalid'), '42501 | sham:address_change_refused',
  '2 username account → a free username''s address: refused');
select pg_temp.signup('free', 'freeuser');
select t.ok(exists (select 1 from usernames where username = 'freeuser'), '2 the free username can still sign up');
select t.eq(pg_temp.change(pg_temp.u('sp'), 'other1@users.sham.invalid'), '42501 | sham:address_change_refused',
  '3 username account → another user''s address: refused');
select t.eq(pg_temp.addr(pg_temp.u('sp')), 'spaced@users.sham.invalid', '1–3 the address is unchanged');
select t.eq((select username from usernames where user_id = pg_temp.u('sp')), 'spaced', '1–3 the username is unchanged');

-- 4: the same address in another letter case is fine.
select t.eq(pg_temp.change(pg_temp.u('sp'), 'SPACED@users.sham.invalid'), 'SPACED@users.sham.invalid',
  '4 same address, other case: allowed');

-- 5–6: an older account can't change its address, not even to a free internal one.
select t.eq(pg_temp.change(pg_temp.u('old'), 'new@x.test'), '42501 | sham:address_change_refused', '5 older account → real email: refused');
select t.eq(pg_temp.change(pg_temp.u('old'), 'squat@users.sham.invalid'), '42501 | sham:address_change_refused',
  '6 older account → a free internal address: refused');
select t.eq(pg_temp.addr(pg_temp.u('old')), 'old@x.test', '5–6 the older address is unchanged');
select pg_temp.signup('squat', 'squat');
select t.ok(exists (select 1 from usernames where username = 'squat'), '6 squat can still sign up');

-- 7: an admin in the SQL Editor may change any address.
update auth.users set email = 'fixed@x.test' where id = pg_temp.u('old');
select t.eq(pg_temp.addr(pg_temp.u('old')), 'fixed@x.test', '7 an admin update is allowed');

-- 8: updates that don't touch the address are unaffected.
set session authorization supabase_auth_admin;
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"x": 1}' where id in (pg_temp.u('sp'), pg_temp.u('old'));
update auth.users set email = email where id = pg_temp.u('sp');
reset session authorization;
select t.ok((select count(*) from auth.users where id in (pg_temp.u('sp'), pg_temp.u('old')) and raw_user_meta_data ? 'x') = 2,
  '8 other updates (and an unchanged address) go through');

-- 9: deleting an account still works and frees the username.
set session authorization supabase_auth_admin;
delete from auth.users where id = pg_temp.u('other');
reset session authorization;
select t.ok(not exists (select 1 from usernames where username = 'other1'), '9 delete still frees the username');

-- 10: nobody in the app can run the guard directly.
select t.ok(not has_function_privilege('anon', 'auth_email_change_guard()', 'execute')
  and not has_function_privilege('authenticated', 'auth_email_change_guard()', 'execute'),
  '10 anon and authenticated can''t execute the guard');
