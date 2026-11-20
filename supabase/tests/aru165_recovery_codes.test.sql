-- ARU-165: recovery codes and Forgot password (supabase/migrations/0073_recovery_codes.sql).
select t.seed();
-- S1 and S2 have usernames; S3 is an older account without one.
insert into usernames (user_id, username) values (t.id('S1'), 'sam'), (t.id('S2'), 'sue');

-- Tables: no app access at all.
select t.ok((select relrowsecurity from pg_class where oid = 'public.recovery_codes'::regclass), 'recovery_codes has RLS on');
select t.ok((select relrowsecurity from pg_class where oid = 'public.recovery_attempts'::regclass), 'recovery_attempts has RLS on');
select t.ok(not exists (select 1 from pg_policies where tablename in ('recovery_codes', 'recovery_attempts')),
  'no policies on either table');
select t.ok(not has_table_privilege(r, tb, p), r || ' has no ' || p || ' on ' || tb)
  from unnest(array['anon', 'authenticated']) r,
       unnest(array['recovery_codes', 'recovery_attempts']) tb,
       unnest(array['insert', 'update', 'delete']) p;
select t.ok(not has_table_privilege('anon', tb, 'select'), 'anon has no select on ' || tb)
  from unnest(array['recovery_codes', 'recovery_attempts']) tb;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- Function access.
select t.ok(not has_function_privilege('anon', f, 'execute'), 'anon cannot execute ' || f)
  from unnest(array['my_recovery_code_saved()', 'make_recovery_code()', 'save_recovery_code(text)',
    'replace_recovery_code(uuid)', 'recovery_check(text,text)', 'recovery_finish(uuid)', 'recovery_code_store(uuid)',
    'recovery_code_generate()', 'recovery_code_hash(text)']) f;
select t.ok(has_function_privilege('authenticated', f, 'execute'), 'authenticated can execute ' || f)
  from unnest(array['my_recovery_code_saved()', 'make_recovery_code()', 'save_recovery_code(text)']) f;
select t.ok(not has_function_privilege('authenticated', f, 'execute'), 'authenticated cannot execute ' || f)
  from unnest(array['replace_recovery_code(uuid)', 'recovery_check(text,text)', 'recovery_finish(uuid)',
    'recovery_code_store(uuid)', 'recovery_code_generate()', 'recovery_code_hash(text)']) f;
select t.ok(has_function_privilege('service_role', f, 'execute'), 'service_role can execute ' || f)
  from unnest(array['replace_recovery_code(uuid)', 'recovery_check(text,text)', 'recovery_finish(uuid)']) f;
select t.ok((select bool_and(prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=public')) from pg_proc
  where proname in ('my_recovery_code_saved', 'make_recovery_code', 'save_recovery_code', 'replace_recovery_code',
    'recovery_check', 'recovery_finish')), 'security definer with search_path = public');

-- Code format: 16 characters of the alphabet, XXXX-XXXX-XXXX-XXXX, all different over many draws.
select t.ok((select bool_and(c ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){3}$')
  from (select recovery_code_generate() c from generate_series(1, 500)) x), 'codes have the format and alphabet');
select t.eq((select count(distinct recovery_code_generate()) from generate_series(1, 500)), 500::bigint, 'codes differ');
select t.eq(recovery_code_hash('abcd-efgh-jkmn-pq23'), recovery_code_hash(' ABCDEFGHJKMNPQ23' || chr(10)),
  'hash ignores case, spaces, dashes and a trailing newline');

-- AC 1: a new account has no saved code; it makes one.
select t.login('S1');
select t.ok(not my_recovery_code_saved(), 'S1 has no saved code at first');
create temp table codes (k text primary key, v text);
grant all on codes to authenticated, anon, service_role;
insert into codes select 'first', make_recovery_code();
reset role;
select t.ok((select code_hash <> (select v from codes where k = 'first') and saved_at is null
  from recovery_codes where user_id = t.id('S1')), 'only the hash is stored, unsaved');
select t.ok(position(replace((select v from codes where k = 'first'), '-', '') in (select code_hash from recovery_codes
  where user_id = t.id('S1'))) = 0, 'the plain code appears nowhere in the row');

-- AC 4: making another one replaces the unsaved code.
select t.login('S1');
insert into codes select 'second', make_recovery_code();
select t.throws($$select save_recovery_code((select v from codes where k = 'first'))$$, '22023',
  'an older code (another device) can''t be marked saved');
select t.ok(not my_recovery_code_saved(), 'still not saved');
-- AC 3: the current one, typed loosely, is saved.
select t.lives($$select save_recovery_code(lower((select v from codes where k = 'second')))$$, 'the current code is saved');
select t.ok(my_recovery_code_saved(), 'S1 now has a saved code');
select t.lives($$select save_recovery_code((select v from codes where k = 'second'))$$, 'saving it again is fine');
-- A stolen session can't replace a saved code without the password.
select t.throws('select make_recovery_code()', '42501', 'make_recovery_code is refused once a code is saved');
-- Nobody can mark another's code or read it.
reset role;
select t.login('S2');
select t.ok(not my_recovery_code_saved(), 'S2 sees only its own state');
select t.throws($$select save_recovery_code((select v from codes where k = 'second'))$$, '22023',
  'S2 can''t save S1''s code');
select t.eq((select count(*) from recovery_codes), 0::bigint, 'authenticated reads no recovery_codes row (no policy)');
select t.eq((select count(*) from recovery_attempts), 0::bigint, 'authenticated reads no recovery_attempts row (no policy)');
select t.throws($$update recovery_codes set saved_at = now()$$, '42501', 'authenticated cannot update recovery_codes');
select t.throws($$delete from recovery_attempts$$, '42501', 'authenticated cannot delete recovery_attempts');
reset role;
-- An account without a username gets no code.
select t.login('S3');
select t.throws('select make_recovery_code()', '42501', 'no username: no code');
reset role;
select t.login(null);
select t.throws('select my_recovery_code_saved()', '42501', 'anon cannot ask');
reset role;

-- AC 7: replace (Edge Function, after the password check) makes the old code stop working; the new one is unsaved.
set role service_role;
insert into codes select 'third', replace_recovery_code(t.id('S1'));
reset role;
select t.ok((select saved_at is null from recovery_codes where user_id = t.id('S1')), 'replaced code is unsaved');
set role service_role;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'second'))), 'wrong',
  'the replaced code no longer works');
-- The current code works whether saved or not, any letter case for the username.
select t.eq((select result from recovery_check(' SAM ', (select v from codes where k = 'third'))), 'ok',
  'the current unsaved code works, username in any case');
select t.eq((select user_id from recovery_check('sam', (select v from codes where k = 'third'))), t.id('S1'),
  'ok returns the account');
reset role;
select t.eq((select failures from recovery_attempts where username = 'sam'), 1, 'one wrong attempt counted');

-- AC 9: finish deletes the code and every session, with ARU-167's trigger in place, and resets the count.
set session authorization supabase_auth_admin;
insert into auth.sessions (user_id, ip, user_agent) values ('00000000-0000-0000-0000-0000000000c1', '203.0.113.1', 'a'),
  ('00000000-0000-0000-0000-0000000000c1', null, null), ('00000000-0000-0000-0000-0000000000c2', null, null);
reset session authorization;
set role service_role;
select recovery_finish(t.id('S1'));
reset role;
select t.ok(not exists (select 1 from auth.sessions where user_id = t.id('S1')), 'all of S1''s sessions are ended');
select t.eq((select count(*) from auth.sessions where user_id = t.id('S2')), 1::bigint, 'other accounts keep theirs');
select t.ok(not exists (select 1 from recovery_codes where user_id = t.id('S1')), 'the used code is gone');
select t.ok(not exists (select 1 from recovery_attempts where username = 'sam'), 'the count is reset');
set role service_role;
select t.eq((select result from recovery_check('sam', (select v from codes where k = 'third'))), 'wrong',
  'the used code no longer works');
reset role;
select t.login('S1');
select t.ok(not my_recovery_code_saved(), 'after recovery S1 has no saved code (the Save screen shows)');
select t.lives('select make_recovery_code()', 'and can make a new one');
reset role;

-- AC 11: 5 wrong → locked for 15 minutes, even with the right code; unknown usernames lock too.
set role service_role;
insert into codes select 'sue', replace_recovery_code(t.id('S2'));
select recovery_check(case when i % 2 = 0 then 'SUE' else 'sue' end, 'AAAA-AAAA-AAAA-AAAA') from generate_series(1, 4) i;
reset role;
select t.ok((select locked_until is null and failures = 4 from recovery_attempts where username = 'sue'), '4 wrong: not locked');
set role service_role;
select t.eq((select result from recovery_check('sue', 'AAAA-AAAA-AAAA-AAAA')), 'wrong', 'the 5th is still "wrong"');
select t.eq((select result from recovery_check('sue', (select v from codes where k = 'sue'))), 'locked',
  'then even the right code is locked');
reset role;
select t.ok((select locked_until between now() + interval '14 minutes' and now() + interval '15 minutes'
  from recovery_attempts where username = 'sue'), 'locked for 15 minutes');
select t.eq((select failures from recovery_attempts where username = 'sue'), 5, 'a locked attempt is not counted');
set role service_role;
select recovery_check('nobody', 'AAAA-AAAA-AAAA-AAAA') from generate_series(1, 5);
select t.eq((select result from recovery_check('nobody', 'AAAA-AAAA-AAAA-AAAA')), 'locked', 'an unknown username locks too');
reset role;
-- The end of the lock resets the count (the row is cleaned up on the next call).
update recovery_attempts set locked_until = now() - interval '1 second' where username = 'sue';
set role service_role;
select t.eq((select result from recovery_check('sue', (select v from codes where k = 'sue'))), 'ok', 'after the lock: ok');
reset role;
select t.eq((select failures from recovery_attempts where username = 'sue'), 0, 'count reset after the lock');
-- Rows untouched for a day are cleaned up.
update recovery_attempts set updated_at = now() - interval '2 days', locked_until = null where username = 'nobody';
set role service_role;
select recovery_check('sue', 'AAAA-AAAA-AAAA-AAAA');
reset role;
select t.ok(not exists (select 1 from recovery_attempts where username = 'nobody'), 'day-old rows are cleaned up');

-- Account deleted: its code and lock rows go with it.
select t.ok(exists (select 1 from recovery_codes where user_id = t.id('S2')), 'setup: S2 has a code');
delete from auth.users where id = t.id('S2');
select t.ok(not exists (select 1 from recovery_codes where user_id = t.id('S2')), 'deleting the account deletes its code');
select t.ok(not exists (select 1 from recovery_attempts where username = 'sue'), 'and its lock row');

-- Teacher-only nothing: nobody (teacher included) can make or replace another's code.
select t.login('T');
select t.throws($$select replace_recovery_code('00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'the teacher cannot replace another person''s code');
reset role;
