-- ARU-165 QA: security checks on recovery codes and Forgot password (0073_recovery_codes.sql), beyond the dev tests.
-- Lock can't be bypassed by username case or spaces; no enumeration through results; used / replaced codes never
-- work; nobody gets at another account's code; ending sessions works with ARU-167's trigger in place.
select t.seed();
insert into usernames (user_id, username) values (t.id('S1'), 'sam'), (t.id('S2'), 'sue'), (t.id('M'), 'max');
create temp table codes (k text primary key, v text);
grant all on codes to authenticated, anon, service_role;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

set role service_role;
insert into codes select 'sam', replace_recovery_code(t.id('S1'));
insert into codes select 'sue', replace_recovery_code(t.id('S2'));
reset role;

-- Tables: no truncate / references / trigger either, for anon and authenticated.
select t.ok(not has_table_privilege(r, tb, p), r || ' has no ' || p || ' on ' || tb)
  from unnest(array['anon', 'authenticated']) r,
       unnest(array['recovery_codes', 'recovery_attempts']) tb,
       unnest(array['truncate', 'references', 'trigger']) p;
-- Only a SHA-256 hex hash is stored.
select t.ok((select bool_and(code_hash ~ '^[0-9a-f]{64}$') from recovery_codes), 'every stored code is a 64-hex hash');
select t.ok(not exists (select 1 from recovery_codes c join codes k on position(upper(replace(k.v, '-', '')) in upper(c.code_hash)) > 0),
  'no plain code appears in any row');

-- AC 10 enumeration: an unknown username and a wrong code for a real one give the same row shape.
set role service_role;
select t.eq((select row(result, user_id)::text from recovery_check('nobody', (select v from codes where k = 'sam'))),
  (select row(result, user_id)::text from recovery_check('max', (select v from codes where k = 'sam'))),
  'unknown username and wrong code answer exactly the same');
-- max has no code at all: a blank or garbage code never matches.
select t.eq((select result from recovery_check('max', '')), 'wrong', 'a blank code is wrong (account without a code)');
select t.eq((select result from recovery_check('sam', '')), 'wrong', 'a blank code is wrong (account with a code)');
select t.eq((select result from recovery_check('sam', null)), 'wrong', 'a null code is wrong');
-- Another account's code doesn't open this one.
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'sue'))), 'wrong',
  'sue''s code does not recover sam');
reset role;
delete from recovery_attempts;

-- AC 11: 5 wrong in mixed case and spacing count for one username.
set role service_role;
select recovery_check(n, 'AAAA-AAAA-AAAA-AAAA') from unnest(array['Sam', 'SAM', ' sam', 'sam ', E'\tsAm\n']) n;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'sam'))), 'locked',
  'case and spaces do not split the count: the right code is locked');
select t.eq((select result from recovery_check('SAM', (select v from codes where k = 'sam'))), 'locked',
  'locked in any letter case');
select t.ok((select user_id is null from recovery_check('SAM', (select v from codes where k = 'sam'))),
  'a locked answer never carries the account id, even with the right code');
reset role;
select t.eq((select count(*) from recovery_attempts where username like '%sam%'), 1::bigint, 'one lock row, lower case');
-- Attempts during the lock don't extend it.
create temp table lock_before as select locked_until from recovery_attempts where username = 'sam';
set role service_role;
select recovery_check('sam', 'AAAA-AAAA-AAAA-AAAA') from generate_series(1, 3);
reset role;
select t.ok((select a.locked_until = b.locked_until from recovery_attempts a, lock_before b where a.username = 'sam'),
  'attempts during the lock do not extend it');
-- The lock is per username: sue still recovers.
set role service_role;
select t.eq((select result from recovery_check('sue', (select v from codes where k = 'sue'))), 'ok',
  'a lock on sam does not affect sue');
reset role;
-- Cleanup of an expired lock leaves active locks alone.
insert into recovery_attempts (username, failures, locked_until) values ('old', 5, now() - interval '1 minute');
set role service_role;
select recovery_check('zed', 'x');
reset role;
select t.ok(not exists (select 1 from recovery_attempts where username = 'old'), 'expired lock row cleaned up');
select t.ok(exists (select 1 from recovery_attempts where username = 'sam' and locked_until > now()),
  'active lock row kept');
-- A finished recovery for another account doesn't clear sam's lock.
set role service_role;
select recovery_finish(t.id('S2'));
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'sam'))), 'locked',
  'another account''s recovery leaves the lock');
reset role;

-- Used code: after recovery_finish(S2), sue's old code neither recovers nor can be marked saved.
set role service_role;
select t.eq((select result from recovery_check('sue', (select v from codes where k = 'sue'))), 'wrong',
  'the used code no longer recovers');
reset role;
select t.login('S2');
select t.throws($$select save_recovery_code((select v from codes where k = 'sue'))$$, '22023',
  'the used code can''t be marked saved');
reset role;

-- Nobody reaches another account's code: a signed-in user can only make / save their own.
select t.login('S2');
insert into codes select 'sue2', make_recovery_code();
reset role;
select t.ok((select saved_at is null from recovery_codes where user_id = t.id('S1')), 'setup: sam''s code is unsaved');
create temp table sam_hash as select code_hash from recovery_codes where user_id = t.id('S1');
select t.login('S2');
select t.throws($$select save_recovery_code((select v from codes where k = 'sam'))$$, '22023',
  'sue can''t mark sam''s code saved');
reset role;
select t.ok((select c.code_hash = h.code_hash and c.saved_at is null from recovery_codes c, sam_hash h
  where c.user_id = t.id('S1')), 'sue''s calls never touched sam''s code');
-- The teacher can't replace, check or finish for anyone.
select t.login('T');
select t.throws($$select recovery_check('sam', 'x')$$, '42501', 'the teacher cannot run recovery_check');
select t.throws($$select recovery_finish('00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'the teacher cannot end another person''s sessions');
reset role;
select t.login(null);
select t.throws($$select recovery_check('sam', 'x')$$, '42501', 'anon cannot run recovery_check');
select t.throws($$select make_recovery_code()$$, '42501', 'anon cannot make a code');
select t.throws($$select save_recovery_code('x')$$, '42501', 'anon cannot save a code');
reset role;

-- AC 9 with ARU-167: the clear_session_ip trigger is still on auth.sessions, and ending sessions works with it.
select t.ok(exists (select 1 from pg_trigger where tgrelid = 'auth.sessions'::regclass and tgname = 'clear_session_ip'),
  'ARU-167 trigger still in place');
set session authorization supabase_auth_admin;
insert into auth.sessions (user_id, ip, user_agent) values ('00000000-0000-0000-0000-0000000000c1', '198.51.100.7', 'x'), ('00000000-0000-0000-0000-0000000000c1', null, null);
reset session authorization;
select t.ok((select bool_and(ip is null) from auth.sessions where user_id = t.id('S1')), 'sessions keep no IP');
update recovery_attempts set locked_until = now() - interval '1 second' where username = 'sam';
set role service_role;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'sam'))), 'ok', 'after the lock: ok');
select recovery_finish(t.id('S1'));
reset role;
select t.eq((select count(*) from auth.sessions where user_id = t.id('S1')), 0::bigint, 'all of sam''s sessions ended');
select t.ok(not exists (select 1 from recovery_codes where user_id = t.id('S1')), 'sam''s used code deleted');
