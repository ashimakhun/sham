-- QA ARU-169: security checks on the teacher's reset codes (0074_reset_codes.sql), beyond the dev tests.
-- Another workspace's teacher can neither make nor replace a code here (and the reverse); a waiting / declined caller
-- is not a teacher; refusals never touch an existing code or the lock; the lock is shared by both kinds of code and
-- by every spelling of the username; the expiry is strict; an unsaved old recovery code goes too (AC 6); a reset code
-- opens only its own account and can't be passed off as a recovery code; workspace_usernames leaks nothing to
-- non-teachers or across workspaces; only the Edge Function's role can check or finish a recovery.
-- Fixture (t.seed): teacher T, mentors M, N, M2, students S1, S2, S3 (S3: no username). W2: teacher XT, mentor XM,
-- student XS, waiting XP (all with usernames).
select t.seed();
insert into usernames (user_id, username) values
  (t.id('S1'), 'sam'), (t.id('S2'), 'sue'), (t.id('M'), 'max'), (t.id('T'), 'tess');
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
create temp table codes (k text primary key, v text);
grant all on codes to authenticated, anon, service_role;

create function t.x(n text) returns uuid language sql immutable as $$ select md5('aru169qa' || n)::uuid $$;
grant execute on function t.x(text) to anon, authenticated, service_role;
create function t.xlogin(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.x(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.xlogin(text) to anon, authenticated;
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
-- The stored hash of a person's reset code (or null).
create function t.rhash(who uuid) returns text language sql security definer as $$
  select code_hash from reset_codes where user_id = who $$;
grant execute on function t.rhash(uuid) to authenticated, service_role;

-- W2.
insert into workspaces (id, name, created_at) values (t.x('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.x('XT'), 'qxt169@x.test', '{"full_name":"Xena Teacher"}'),
  (t.x('XM'), 'qxm169@x.test', '{"full_name":"Xavier Mentor"}'),
  (t.x('XS'), 'qxs169@x.test', '{"full_name":"Xia Student"}'),
  (t.x('XP'), 'qxp169@x.test', '{"full_name":"Xo Pending"}');
update profiles set workspace_id = t.x('W2') where id in (t.x('XT'), t.x('XM'), t.x('XS'), t.x('XP'));
update profiles set access_status = 'approved' where id in (t.x('XT'), t.x('XM'), t.x('XS'));
update profiles set role = 'teacher' where id = t.x('XT');
update profiles set role = 'mentor', is_accountant = true where id = t.x('XM');
insert into usernames (user_id, username) values
  (t.x('XT'), 'xena'), (t.x('XM'), 'xavier'), (t.x('XS'), 'xia'), (t.x('XP'), 'xoxo');

-- T makes a code for S1 (kept for the "nothing changed" checks below).
select t.login('T');
insert into codes select 'a', code from make_reset_code(t.id('S1'));
reset role;
create temp table h0 as select t.rhash(t.id('S1')) as h;
grant select on h0 to authenticated, service_role;

-- Cross-workspace, both ways: not found, and the existing code is untouched.
select t.xlogin('XT');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('S1'))), 'P0002 | sham:user_not_found',
  'W2''s teacher can''t make a code for W1''s student');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('M'))), 'P0002 | sham:user_not_found',
  'W2''s teacher can''t make a code for W1''s mentor');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('T'))), 'P0002 | sham:user_not_found',
  'W2''s teacher can''t make a code for W1''s teacher');
select t.eq(pg_temp.err('select make_reset_code(null)'), 'P0002 | sham:user_not_found', 'a null target: not found');
reset role;
select t.ok(t.rhash(t.id('S1')) = (select h from h0), 'W2''s attempts left S1''s code as it was');
select t.login('T');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.x('XS'))), 'P0002 | sham:user_not_found',
  'W1''s teacher can''t make a code for W2''s student');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.x('XM'))), 'P0002 | sham:user_not_found',
  'W1''s teacher can''t make a code for W2''s accountant mentor');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.x('XT'))), 'P0002 | sham:user_not_found',
  'W1''s teacher can''t make a code for W2''s teacher');
reset role;
select t.eq((select count(*) from reset_codes where user_id in (t.x('XS'), t.x('XM'), t.x('XT'))), 0::bigint,
  'no code exists in W2');

-- Non-teacher callers (accountant, student, waiting) never replace an existing code.
update profiles set is_accountant = true where id = t.id('M2');
select t.login('M2');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('S1'))), '42501 | sham:only_teacher_reset_code',
  'an accountant can''t make a code');
reset role;
select t.login('S1');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.id('S1'))), '42501 | sham:only_teacher_reset_code',
  'a student can''t make a code for themselves');
reset role;
select t.xlogin('XP');
select t.eq(pg_temp.err(format('select make_reset_code(%L)', t.x('XS'))), '42501 | sham:only_teacher_reset_code',
  'a waiting account can''t make a code');
reset role;
-- (A teacher is always Approved: 0021's profiles_teacher_approved trigger, so there is no declined teacher.)
select t.ok(t.rhash(t.id('S1')) = (select h from h0), 'non-teacher attempts left S1''s code as it was');
select t.eq((select count(*) from reset_codes where user_id = t.x('XS')), 0::bigint, 'and made none in W2');

-- The teacher's refusals for S1's neighbours don't touch S1's code; a refused call makes no lock row either.
select t.login('T');
select pg_temp.err(format('select make_reset_code(%L)', t.id('S3')));
select pg_temp.err(format('select make_reset_code(%L)', t.id('T')));
reset role;
select t.ok(t.rhash(t.id('S1')) = (select h from h0), 'refusals for others left S1''s code as it was');
select t.eq((select count(*) from recovery_attempts), 0::bigint, 'making codes never touches the lock counter');

-- Function grants: only the Edge Function's role checks and finishes; nobody signed in or signed out does.
select t.ok(not has_function_privilege(r, f, 'execute'), r || ' cannot execute ' || f)
  from unnest(array['anon', 'authenticated']) r,
       unnest(array['recovery_check(text, text)', 'recovery_finish(uuid)']) f;
select t.ok(not has_function_privilege('service_role', 'make_reset_code(uuid)', 'execute'),
  'service_role cannot make a code (no auth.uid())');
select t.ok(not has_table_privilege(r, 'reset_codes', p), r || ' has no ' || p || ' on reset_codes')
  from unnest(array['anon', 'authenticated']) r, unnest(array['truncate', 'references', 'trigger']) p;
select t.login('S1');
select t.eq((select count(*) from reset_codes), 0::bigint, 'the person reads no reset_codes row, even their own');
select t.throws(format('update reset_codes set expires_at = now() + interval ''1 year'' where user_id = %L', t.id('S1')),
  '42501', 'the person can''t extend their code');
reset role;
select t.ok((select code_hash ~ '^[0-9a-f]{64}$' from reset_codes where user_id = t.id('S1')), 'the hash is 64-hex SHA-256');

-- Two codes in a row differ.
select t.login('T');
insert into codes select 'b', code from make_reset_code(t.id('S2'));
insert into codes select 'c', code from make_reset_code(t.id('S2'));
reset role;
select t.ok((select v from codes where k = 'b') <> (select v from codes where k = 'c'), 'every code is new');
select t.ok((select v from codes where k = 'a') <> (select v from codes where k = 'c'), 'codes for different people differ');

-- A reset code opens only its own account: not the teacher's, not another student's, not W2's.
set role service_role;
select t.eq((select result from recovery_check('tess', (select v from codes where k = 'a'))), 'wrong',
  'S1''s reset code does not recover the teacher');
select t.eq((select result from recovery_check('xia', (select v from codes where k = 'a'))), 'wrong',
  'S1''s reset code does not recover a W2 student');
select t.eq((select result from recovery_check('sue', (select v from codes where k = 'a'))), 'wrong',
  'S1''s reset code does not recover S2 (who has a code of their own)');
select t.eq((select row(result, user_id)::text from recovery_check('nobody169', (select v from codes where k = 'a'))),
  (select row(result, user_id)::text from recovery_check('max', (select v from codes where k = 'a'))),
  'unknown username and wrong reset code answer the same');
reset role;
delete from recovery_attempts;

-- Username spelling: any case or surrounding spaces finds the account and shares one counter.
set role service_role;
select t.eq((select result from recovery_check(' SAM ', (select v from codes where k = 'a'))), 'ok',
  'the reset code works with the username in any case and spacing');
select t.eq((select user_id from recovery_check('Sam', lower(replace((select v from codes where k = 'a'), '-', ' ')))),
  t.id('S1'), 'and with the code in lower case, spaces for dashes');
-- 5 wrong in mixed spelling and mixed kinds: a wrong recovery-style code, an old (replaced) reset code, S2's reset code.
select recovery_check(n, c) from (values
  ('Sam', 'AAAA-AAAA-AAAA-AAAA'),
  ('SAM', (select v from codes where k = 'b')),
  (' sam', (select v from codes where k = 'c')),
  ('sAm ', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ'),
  (E'\tsam\n', 'BBBB-BBBB-BBBB-BBBB')) x(n, c);
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'a'))), 'locked',
  'one shared lock: the valid reset code is refused');
select t.eq((select result from recovery_check('SAM', (select v from codes where k = 'a'))), 'locked',
  'locked in any spelling');
select t.ok((select user_id is null from recovery_check('Sam', (select v from codes where k = 'a'))),
  'a locked answer never carries the account id');
reset role;
select t.eq((select count(*) from recovery_attempts where lower(username) like '%sam%'), 1::bigint, 'one lock row');
select t.ok(exists (select 1 from reset_codes where user_id = t.id('S1')), 'the lock left the reset code in place');
-- The other person's code and lock are their own.
set role service_role;
select t.eq((select result from recovery_check('sue', (select v from codes where k = 'c'))), 'ok',
  'S2 is not locked by S1''s failures');
reset role;
delete from recovery_attempts;

-- A wrong code counts once when the account has both kinds.
insert into recovery_codes (user_id, code_hash, saved_at) values (t.id('S1'), recovery_code_hash('RECO-VERY-CODE-AAAA'), now());
set role service_role;
select recovery_check('sam', 'WWWW-WWWW-WWWW-WWWW');
reset role;
select t.eq((select failures from recovery_attempts where username = 'sam'), 1, 'one wrong try counts once');
-- Either kind works, and a success does not count.
set role service_role;
select t.eq((select result from recovery_check('sam', 'RECO-VERY-CODE-AAAA')), 'ok', 'the recovery code works');
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'a'))), 'ok', 'the reset code works');
reset role;
select t.eq((select failures from recovery_attempts where username = 'sam'), 1, 'successes are not counted');
delete from recovery_attempts;

-- Expiry is strict: at the exact expiry instant it no longer works.
update reset_codes set expires_at = now() where user_id = t.id('S1');
set role service_role;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'a'))), 'wrong',
  'a code at its expiry instant is refused');
reset role;
update reset_codes set expires_at = now() + interval '1 second' where user_id = t.id('S1');
set role service_role;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'a'))), 'ok',
  'a second before its expiry it works');
reset role;
delete from recovery_attempts;

-- AC 6 with an unsaved old recovery code: both codes go, and every session ends.
update recovery_codes set saved_at = null where user_id = t.id('S1');
insert into auth.sessions (id, user_id) values (gen_random_uuid(), t.id('S1')), (gen_random_uuid(), t.id('S1'));
set role service_role;
select recovery_finish(t.id('S1'));
select t.eq((select result from recovery_check('sam', 'RECO-VERY-CODE-AAAA')), 'wrong', 'the unsaved old recovery code stopped');
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'a'))), 'wrong', 'the used reset code stopped');
reset role;
select t.eq((select count(*) from auth.sessions where user_id = t.id('S1')), 0::bigint, 'every session of the account ended');
select t.ok(exists (select 1 from reset_codes where user_id = t.id('S2')), 'S2''s code is untouched by S1''s recovery');
delete from recovery_attempts;

-- A reset code can't be passed off as the person's own recovery code (save_recovery_code compares recovery codes only).
select t.login('T');
insert into codes select 'd', code from make_reset_code(t.id('S1'));
reset role;
set role service_role;
insert into codes select 'own', replace_recovery_code(t.id('S1'));
reset role;
select t.login('S1');
select t.ok(pg_temp.err(format('select save_recovery_code(%L)', (select v from codes where k = 'd'))) <> 'no error',
  'saving the reset code as the recovery code is refused');
reset role;
select t.ok((select saved_at is null from recovery_codes where user_id = t.id('S1')), 'the recovery code stays unsaved');
select t.ok(exists (select 1 from reset_codes where user_id = t.id('S1')), 'and the reset code stays');

-- workspace_usernames: each teacher sees their own workspace only; nobody else sees anything.
select t.xlogin('XT');
select t.eq((select string_agg(username, ',' order by username) from workspace_usernames()), 'xavier,xena,xia',
  'W2''s teacher: W2''s accepted accounts only (no waiting one, nothing from W1)');
reset role;
select t.login('T');
select t.ok(not exists (select 1 from workspace_usernames() w where w.username in ('xena', 'xavier', 'xia', 'xoxo')),
  'W1''s teacher sees no W2 username');
select t.ok(not exists (select 1 from workspace_usernames() w
  where w.user_id not in (select id from profiles where workspace_id = (select workspace_id from profiles where id = t.id('T')))),
  'every row is an account of the teacher''s workspace');
reset role;
select t.xlogin('XM');
select t.eq((select count(*) from workspace_usernames()), 0::bigint, 'an accountant mentor gets no usernames');
select t.eq((select string_agg(username, ',') from usernames), 'xavier', 'and still reads only their own usernames row');
reset role;
select t.xlogin('XP');
select t.eq((select count(*) from workspace_usernames()), 0::bigint, 'a waiting account gets no usernames');
reset role;
select t.login(null);
select t.eq(pg_temp.err('select workspace_usernames()'), '42501 | ', 'signed out: no execute');
reset role;
