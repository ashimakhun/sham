-- ARU-168: older accounts choose a username, then their real email is erased; after the deadline a daily job moves the
-- rest, never a teacher (criterion change, 19 Nov). Rules under test: supabase/migrations/0070_existing_usernames.sql.
-- choose_username() is called as Supabase's API does: session user `authenticator` (not an admin), role
-- authenticated, so ARU-175's address guard (0067) really applies and the row-before-address order is proven.
select t.seed();
create role authenticator noinherit nologin;
grant authenticated, anon to authenticator;
grant usage on schema t to authenticator;
grant execute on all functions in schema t to authenticator;
grant usage on schema t to supabase_auth_admin;
grant execute on all functions in schema t to supabase_auth_admin;

-- Personal data Supabase Auth keeps for S1 (and a bit for S2), as on the live project.
update auth.users set raw_user_meta_data = '{"full_name": "Student Sam", "email": "s1@x.test", "name": "Sam", "email_verified": true}',
  email_change = 'sam.new@x.test', email_change_token_new = 'tok-new', email_change_token_current = 'tok-cur',
  email_change_confirm_status = 1, confirmation_token = 'conf', recovery_token = 'rec', reauthentication_token = 'reauth'
  where id = t.id('S1');
insert into auth.identities (provider_id, user_id, identity_data, provider) values
  (t.id('S1')::text, t.id('S1'), jsonb_build_object('sub', t.id('S1')::text, 'email', 's1@x.test', 'full_name', 'Student Sam',
    'email_verified', true, 'phone_verified', false), 'email'),
  (t.id('S2')::text, t.id('S2'), jsonb_build_object('sub', t.id('S2')::text, 'email', 's2@x.test', 'email_verified', true), 'email');
insert into auth.audit_log_entries (payload) values
  (json_build_object('action', 'login', 'actor_id', t.id('S1'), 'actor_username', 's1@x.test', 'log_type', 'account',
    'traits', json_build_object('provider', 'email'))),
  (json_build_object('action', 'user_signedup', 'actor_id', t.id('S1'), 'actor_username', 'S1@X.test',
    'traits', json_build_object('user_id', t.id('S1'), 'user_email', 's1@x.test'))),
  (json_build_object('action', 'user_modified', 'actor_id', t.id('T'), 'actor_username', 't@x.test',
    'traits', json_build_object('user_id', t.id('S1'), 'user_email', 'S1@x.test'))),
  (json_build_object('action', 'login', 'actor_id', t.id('S2'), 'actor_username', 's2@x.test'));
insert into auth.one_time_tokens (user_id, token_type, token_hash, relates_to) values
  (t.id('S1'), 'recovery_token', 'h1', 's1@x.test'),
  (t.id('S1'), 'email_change_token_new', 'h2', 'sam.new@x.test'),
  (t.id('S2'), 'recovery_token', 'h3', 's2@x.test');
insert into auth.sessions (user_id) values (t.id('S1')), (t.id('S1')), (t.id('S2'));
-- S3 is waiting for approval (any access status may choose).
update profiles set access_status = 'pending' where id = t.id('S3');

-- Calls choose_username() as `who` through the API; returns 'ok' or 'SQLSTATE | hint'.
create function pg_temp.choose(who text, uname text, display text) returns text language plpgsql as $$
declare code text; hint text; result text := 'ok';
begin
  execute 'set session authorization authenticator';
  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(t.id(who), md5(who)::uuid), 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
  begin
    perform choose_username(uname, display);
  exception when others then
    get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
    result := concat_ws(' | ', code, nullif(hint, ''));
  end;
  execute 'reset role';
  execute 'reset session authorization';
  perform set_config('request.jwt.claims', '', false);
  return result;
end $$;
create function pg_temp.addr(who text) returns text language sql as $$ select email from auth.users where id = t.id(who) $$;
create function pg_temp.uname(who text) returns text language sql as $$ select username from usernames where user_id = t.id(who) $$;
create function pg_temp.audit_text() returns text language sql as $$ select string_agg(payload::text, ' ') from auth.audit_log_entries $$;

-- A part-1 account (signs up with a username) and an Auth address with no usernames row.
select set_config('t.code', (select c.code from workspace_invite_codes c join profiles p on p.workspace_id = c.workspace
  where p.id = t.id('T')), false);
set session authorization supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data) values (md5('new')::uuid, 'taken1@users.sham.invalid',
  jsonb_build_object('username', 'taken1', 'full_name', 'New One', 'invite_code', current_setting('t.code'), 'terms_version', 1));
reset session authorization;
insert into auth.users (id, email) values (md5('ghost')::uuid, 'ghost@users.sham.invalid');

-- Data: the deadline is about 60 days ahead; the cron job is scheduled.
select t.ok((select username_deadline between now() + interval '59 days 23 hours' and now() + interval '60 days 1 hour' from app_settings),
  'deadline is now + 60 days');
select t.ok(exists (select 1 from cron.job where jobname = 'username-deadline' and command like '%move_unclaimed_accounts()%'),
  'the daily job is scheduled');

-- Access.
select t.ok(not has_function_privilege('anon', 'choose_username(text, text)', 'execute'), 'anon can''t call choose_username');
select t.ok(has_function_privilege('authenticated', 'choose_username(text, text)', 'execute'), 'authenticated can call choose_username');
select t.ok(not has_function_privilege('anon', 'move_unclaimed_accounts()', 'execute')
  and not has_function_privilege('authenticated', 'move_unclaimed_accounts()', 'execute')
  and not has_function_privilege('service_role', 'move_unclaimed_accounts()', 'execute'),
  'only postgres runs the job function');
select t.ok(not has_function_privilege('anon', 'move_to_username(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'move_to_username(uuid, text)', 'execute')
  and not has_function_privilege('service_role', 'move_to_username(uuid, text)', 'execute'),
  'nobody in the app runs the move routine');
select t.login('S1');
select t.throws('insert into usernames (user_id, username) values (auth.uid(), ''direct'')', '42501', 'usernames: no direct insert');
reset role;

-- AC 7: refusals change nothing.
select t.eq(pg_temp.choose('S1', 'a', 'Sam'), '23514 | sham:username_invalid', 'AC7 invalid username');
select t.eq(pg_temp.choose('S1', 'bad..name', 'Sam'), '23514 | sham:username_invalid', 'AC7 ".." refused');
select t.eq(pg_temp.choose('S1', 'samsmith', '   '), '23514 | sham:display_name_invalid', 'AC7 blank display name');
select t.eq(pg_temp.choose('S1', 'samsmith', repeat('x', 81)), '23514 | sham:display_name_invalid', 'AC7 81-character display name');
select t.eq(pg_temp.choose('S1', 'TAKEN1', 'Sam'), '23505 | sham:username_taken', 'AC4/7 taken in another letter case');
select t.eq(pg_temp.choose('S1', 'ghost', 'Sam'), '23505 | sham:username_taken', 'AC7 taken as an Auth address only');
select t.eq(pg_temp.choose('new', 'whatever', 'X'), '23505 | sham:username_already_set', 'AC7 a part-1 account already has one');
select t.ok(pg_temp.uname('S1') is null and pg_temp.addr('S1') = 's1@x.test'
  and (select full_name from profiles where id = t.id('S1')) = 'Student Sam'
  and (select count(*) from auth.one_time_tokens where user_id = t.id('S1')) = 2,
  'AC7 each refusal changed nothing');

-- AC 3 / AC 6: Save moves S1 over (through the guard: session user authenticator).
select t.eq(pg_temp.choose('S1', '  Sam.Smith ', ' Sam S @home '), 'ok', 'AC3 Save succeeds (capitals accepted, @ in the name allowed)');
select t.eq(pg_temp.uname('S1'), 'sam.smith', 'AC3 the username is saved in lower case');
select t.eq((select full_name from profiles where id = t.id('S1')), 'Sam S @home', 'AC3 the display name is saved, trimmed');
select t.eq(pg_temp.addr('S1'), 'sam.smith@users.sham.invalid', 'AC6 auth.users.email is the internal address');
select t.ok((select email_change = '' and email_change_token_new = '' and email_change_token_current = ''
    and email_change_confirm_status = 0 and confirmation_token = '' and recovery_token = '' and reauthentication_token = ''
  from auth.users where id = t.id('S1')), 'AC6 pending email change and email tokens are empty');
select t.ok((select not (raw_user_meta_data ? 'email') and not (raw_user_meta_data ? 'full_name') and not (raw_user_meta_data ? 'name')
    and raw_user_meta_data::text not ilike '%s1@x.test%' and raw_user_meta_data::text not like '%Student Sam%'
  from auth.users where id = t.id('S1')), 'AC6 user metadata keeps no email or sign-up name');
select t.eq((select identity_data from auth.identities where user_id = t.id('S1')),
  jsonb_build_object('sub', t.id('S1')::text, 'email', 'sam.smith@users.sham.invalid', 'email_verified', true, 'phone_verified', false),
  'AC6 identity_data has only the internal address and no other personal keys');
select t.eq((select email from auth.identities where user_id = t.id('S1')), 'sam.smith@users.sham.invalid', 'AC6 identities.email follows');
select t.ok(pg_temp.audit_text() not ilike '%s1@x.test%', 'AC6 no audit entry has the old email (any case)');
select t.ok((select count(*) = 2 from auth.audit_log_entries where payload ->> 'actor_id' = t.id('S1')::text
  and payload ->> 'actor_username' = 'sam.smith@users.sham.invalid'), 'AC6 the user''s audit entries name the internal address');
select t.ok(pg_temp.audit_text() ilike '%s2@x.test%' and pg_temp.audit_text() like '%t@x.test%', 'AC6 other users'' audit entries are untouched');
select t.eq((select count(*) from auth.one_time_tokens where user_id = t.id('S1')), 0::bigint, 'AC6 the user''s one-time tokens are deleted');
select t.eq((select count(*) from auth.one_time_tokens where user_id = t.id('S2')), 1::bigint, 'AC6 other users'' tokens stay');
select t.eq((select count(*) from auth.sessions where user_id = t.id('S1')), 2::bigint, 'AC6 sessions stay valid');

-- AC 7: already set (S1 now, and a part-1 account).
select t.eq(pg_temp.choose('S1', 'another', 'Sam'), '23505 | sham:username_already_set', 'AC7 already set after Save');
select t.eq(pg_temp.uname('S1'), 'sam.smith', 'AC7 already set changed nothing');
select t.eq(pg_temp.choose('S3', 'S3ok', 'Waiting Sid'), 'ok', 'AC1 a waiting account can save too');
select t.eq(pg_temp.addr('S3'), 's3ok@users.sham.invalid', 'AC3 the waiting account is moved');

-- ARU-175 still refuses address changes made outside the move.
set session authorization supabase_auth_admin;
select t.throws($$update auth.users set email = 'x@users.sham.invalid' where id = '$$ || t.id('S2') || $$'$$, '42501',
  'ARU-175 an older account still can''t change its own address');
select t.throws($$update auth.users set email = 'real@gmail.com' where id = '$$ || t.id('S1') || $$'$$, '42501',
  'ARU-175 a moved account can''t switch to a real email');
reset session authorization;

-- AC 8: before the deadline the job does nothing.
update profiles set full_name = 'm@x.test' where id = t.id('M');
select t.eq(move_unclaimed_accounts(), 0, 'AC8 before the deadline: nothing moved');
select t.ok(pg_temp.uname('S2') is null and pg_temp.addr('S2') = 's2@x.test', 'AC8 before the deadline: S2 unchanged');

-- After the deadline: students and mentors are moved, the teacher is not.
update app_settings set username_deadline = now() - interval '1 minute';
select t.eq(move_unclaimed_accounts(), 5, 'AC8 the job moves the 5 remaining non-teacher accounts (S2, M, N, M2, and the admin-made one)');
select t.ok((select bool_and(username ~ '^user-[a-z0-9]{6}$') from usernames where user_id in (t.id('S2'), t.id('M'), t.id('N'), t.id('M2'))),
  'AC8 generated usernames are user- + 6 of a-z0-9');
select t.ok((select count(distinct username) = 4 and bool_and(username_is_valid(username)) from usernames
  where user_id in (t.id('S2'), t.id('M'), t.id('N'), t.id('M2'))), 'AC8 generated usernames are unique and valid');
select t.ok((select bool_and(a.email = u.username || '@users.sham.invalid') from usernames u join auth.users a on a.id = u.user_id
  where u.user_id in (t.id('S2'), t.id('M'), t.id('N'), t.id('M2'))), 'AC8 each moved account has its internal address');
select t.eq((select full_name from profiles where id = t.id('M')), pg_temp.uname('M'), 'AC8 an email-like name becomes the username');
select t.eq((select full_name from profiles where id = t.id('N')), 'Mentor Nina', 'AC8 other names are kept');
select t.ok(pg_temp.audit_text() not ilike '%s2@x.test%' and (select count(*) from auth.one_time_tokens where user_id = t.id('S2')) = 0
  and (select identity_data ->> 'email' from auth.identities where user_id = t.id('S2')) = pg_temp.uname('S2') || '@users.sham.invalid',
  'AC6 the job erases the same places');
select t.eq((select count(*) from auth.sessions where user_id = t.id('S2')), 1::bigint, 'AC9 the job leaves sessions valid');
select t.ok(pg_temp.uname('T') is null and pg_temp.addr('T') = 't@x.test', 'criterion change: the teacher is never moved');
select t.eq(pg_temp.uname('S1'), 'sam.smith', 'AC8 an account with a username is untouched');

-- Idempotent.
create temp table before_rerun as select user_id, username from usernames;
select t.eq(move_unclaimed_accounts(), 0, 'AC8 a second run moves nothing');
select t.ok(not exists ((select user_id, username from usernames) except (select * from before_rerun))
  and pg_temp.addr('T') = 't@x.test', 'AC8 a second run changes nothing');

-- A teacher who later chooses a username is moved normally.
select t.eq(pg_temp.choose('T', 'tess', 'Teacher Tess'), 'ok', 'criterion change: the teacher can still choose');
select t.eq(pg_temp.addr('T'), 'tess@users.sham.invalid', 'criterion change: the teacher is then moved');
select t.ok(pg_temp.audit_text() not like '%t@x.test%', 'criterion change: the teacher''s old email is erased too');
