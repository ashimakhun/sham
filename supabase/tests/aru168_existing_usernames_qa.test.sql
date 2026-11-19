-- ARU-168 QA: security and edge cases of choose_username() / move_unclaimed_accounts() (0070) beyond the dev tests:
-- own account only, no caller, emails with regex characters in the audit log, identities keyed by the old email,
-- a moved account can't take another address, generated usernames stay taken, Cyrillic display names, the teacher
-- with an email-like name, and (last, it fails on 2b28a7f) the sign-up name Supabase Auth copies into audit entries
-- as `actor_name`.
select t.seed();
-- Roles are cluster-wide: aru168_existing_usernames may have created it already.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit nologin; end if; end $$;
grant authenticated, anon to authenticator;
grant usage on schema t to authenticator;
grant execute on all functions in schema t to authenticator;
grant usage on schema t to supabase_auth_admin;
grant execute on all functions in schema t to supabase_auth_admin;

-- Calls choose_username() through the API as `who` (null: no user in the token); returns 'ok' or 'SQLSTATE | hint'.
create function pg_temp.choose(who text, uname text, display text) returns text language plpgsql as $$
declare code text; hint text; result text := 'ok';
begin
  execute 'set session authorization authenticator';
  if who is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, false);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', t.id(who), 'role', 'authenticated')::text, false);
  end if;
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

-- S2 has an email with regex characters; its identity is keyed by the email (older Supabase projects did that).
update auth.users set email = 'a.b+c@x.test',
  raw_user_meta_data = '{"full_name": "Sue Real", "email": "a.b+c@x.test", "sub": "x"}' where id = t.id('S2');
insert into auth.identities (provider_id, user_id, identity_data, provider) values
  ('a.b+c@x.test', t.id('S2'), jsonb_build_object('sub', t.id('S2')::text, 'email', 'a.b+c@x.test', 'full_name', 'Sue Real',
    'name', 'Sue', 'avatar_url', 'http://x/a.png'), 'email'),
  (t.id('S1')::text, t.id('S1'), jsonb_build_object('sub', t.id('S1')::text, 'email', 's1@x.test'), 'email');
insert into auth.audit_log_entries (payload) values
  (json_build_object('action', 'login', 'actor_id', t.id('S2'), 'actor_username', 'A.B+C@x.test', 'actor_name', 'Sue Real',
    'traits', json_build_object('provider', 'email'))),
  -- Other people's entries with look-alike addresses: a regex without escaping would match them.
  (json_build_object('action', 'login', 'actor_id', t.id('M'), 'actor_username', 'aXb+c@x.test')),
  (json_build_object('action', 'login', 'actor_id', t.id('N'), 'actor_username', 'a.bbc@x.test')),
  (json_build_object('action', 'login', 'actor_id', t.id('S1'), 'actor_username', 's1@x.test')),
  (json_build_object('action', 'login', 'actor_id', t.id('T'), 'actor_username', 't@x.test', 'actor_name', 'Teacher Tess'));
insert into auth.one_time_tokens (user_id, token_type, token_hash, relates_to) values
  (t.id('S1'), 'recovery_token', 'h1', 's1@x.test');

-- No user in the token: refused, nothing changes.
select t.eq(pg_temp.choose(null, 'nobody', 'No One'), '42501 | sham:sign_in_again', 'no caller: refused');
select t.eq((select count(*) from usernames), 0::bigint, 'no caller: no usernames row');

-- Own account only: S2's Save never touches S1.
select t.eq(pg_temp.choose('S2', 'sue', 'Sue'), 'ok', 'S2 saves');
select t.ok(pg_temp.uname('S1') is null and pg_temp.addr('S1') = 's1@x.test'
  and (select identity_data ->> 'email' from auth.identities where user_id = t.id('S1')) = 's1@x.test'
  and (select count(*) from auth.one_time_tokens where user_id = t.id('S1')) = 1
  and exists (select 1 from auth.audit_log_entries where payload::text like '%s1@x.test%'),
  'own account only: S1 is untouched by S2''s Save');
select t.eq(pg_temp.addr('S2'), 'sue@users.sham.invalid', 'S2 moved');

-- Regex characters in the old email: S2's entries are cleared, look-alikes of other people stay as they were.
select t.ok(not exists (select 1 from auth.audit_log_entries where payload::text ilike '%a.b+c@x.test%'),
  'audit: the old email with . and + is erased in any letter case');
select t.ok(exists (select 1 from auth.audit_log_entries where payload ->> 'actor_username' = 'aXb+c@x.test')
  and exists (select 1 from auth.audit_log_entries where payload ->> 'actor_username' = 'a.bbc@x.test'),
  'audit: other people''s look-alike addresses are untouched');
select t.ok(exists (select 1 from auth.audit_log_entries where payload ->> 'actor_name' = 'Teacher Tess'),
  'audit: other people''s names are untouched');

-- Identity keyed by the old email: re-keyed to the user id, only sub / email / verified flags stay.
select t.eq((select provider_id from auth.identities where user_id = t.id('S2')), t.id('S2')::text,
  'identity keyed by the old email gets the user id as its key');
select t.ok((select not (identity_data ?| array['full_name', 'name', 'avatar_url']) and identity_data ->> 'email' = 'sue@users.sham.invalid'
  from auth.identities where user_id = t.id('S2')), 'identity_data keeps no name or other personal keys');
select t.ok((select raw_user_meta_data::text not ilike '%a.b+c@x.test%' and raw_user_meta_data::text not like '%Sue Real%'
  from auth.users where id = t.id('S2')), 'metadata keeps no old email or sign-up name');

-- A moved account can't take another address afterwards (ARU-175 guard still applies after the move).
set session authorization supabase_auth_admin;
select t.throws($$update auth.users set email = 'other@users.sham.invalid' where id = '$$ || t.id('S2') || $$'$$, '42501',
  'a moved account can''t switch to another free username''s address');
select t.throws($$update auth.users set email = 'a.b+c@x.test' where id = '$$ || t.id('S2') || $$'$$, '42501',
  'a moved account can''t get its real email back');
reset session authorization;

-- Nobody takes a username already used, in any spelling.
select t.eq(pg_temp.choose('S1', 'SUE', 'Sam'), '23505 | sham:username_taken', 'S1 can''t take S2''s username (upper case)');
select t.eq(pg_temp.choose('S1', ' sue ', 'Sam'), '23505 | sham:username_taken', 'S1 can''t take S2''s username (spaces)');
select t.ok(pg_temp.addr('S1') = 's1@x.test' and pg_temp.uname('S1') is null, 'refusal left S1 unchanged');

-- Display name limits count characters, not bytes (Russian names).
select t.eq(pg_temp.choose('S1', 'sam', repeat('ж', 81)), '23514 | sham:display_name_invalid', '81 Cyrillic characters refused');
select t.eq(pg_temp.choose('S1', 'sam', repeat('ж', 80)), 'ok', '80 Cyrillic characters accepted');

-- The job: the teacher with an email-like name is left alone; generated usernames stay taken for people choosing later.
update profiles set full_name = 't@x.test' where id = t.id('T');
-- ARU-176 fix, job path (AC 8): a mentor's sign-up name in its audit entries goes too.
insert into auth.audit_log_entries (payload) values
  (json_build_object('action', 'token_refreshed', 'actor_id', t.id('M'), 'actor_username', 'm@x.test', 'actor_name', 'Mentor Real'));
update app_settings set username_deadline = now() - interval '1 day';
select t.ok(move_unclaimed_accounts() >= 1, 'the job moves the remaining students and mentors');
select t.ok(pg_temp.uname('T') is null and pg_temp.addr('T') = 't@x.test'
  and (select full_name from profiles where id = t.id('T')) = 't@x.test', 'the job leaves the teacher (and its name) alone');
select t.eq(pg_temp.choose('T', pg_temp.uname('S3'), 'Tess'), '23505 | sham:username_taken', 'a generated username is taken for others');
select t.ok(pg_temp.addr('T') = 't@x.test', 'the teacher is unchanged after the refusal');
select t.ok(pg_temp.uname('M') is not null
  and not exists (select 1 from auth.audit_log_entries where payload::text like '%Mentor Real%'),
  'AC6 via the job: the moved mentor''s sign-up name (actor_name) is erased too');
select t.ok(exists (select 1 from auth.audit_log_entries where payload ->> 'actor_name' = 'Teacher Tess'),
  'criterion change: the job leaves the unmoved teacher''s audit entries as they were');
select t.ok((select bool_and(a.email = u.username || '@users.sham.invalid') from usernames u join auth.users a on a.id = u.user_id),
  'every usernames row matches its account''s Auth address');

-- AC 6: "the name it gave at sign-up" must not remain in auth.audit_log_entries.payload. Supabase Auth writes the
-- metadata full_name into each entry as `actor_name` (internal/models/audit_log_entry.go, NewAuditLogEntry).
-- Last on purpose: fails on 2b28a7f (the move rewrites actor_username and user_email, but not actor_name).
select t.ok(not exists (select 1 from auth.audit_log_entries where payload ->> 'actor_id' = t.id('S2')::text
  and payload::text like '%Sue Real%'), 'AC6 the sign-up name (actor_name) is erased from the user''s audit entries');
