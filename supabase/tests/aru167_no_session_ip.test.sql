-- ARU-167: Sham never stores IP addresses or user agents. Supabase Auth writes them into auth.sessions; the trigger from
-- supabase/migrations/0068_no_session_ip.sql sets both to null on every insert and update.
select t.seed();

-- AC 5: the function is hardened and the trigger is before insert or update, for each row, on auth.sessions.
select t.ok((select prosecdef from pg_proc where oid = 'public.clear_session_ip()'::regprocedure),
  'clear_session_ip() is security definer');
select t.ok((select exists (select 1 from unnest(proconfig) c where c like 'search_path=%')
  from pg_proc where oid = 'public.clear_session_ip()'::regprocedure), 'clear_session_ip() has a fixed search_path');
select t.ok(not has_function_privilege('anon', 'public.clear_session_ip()', 'execute'), 'anon cannot execute it');
select t.ok(not has_function_privilege('authenticated', 'public.clear_session_ip()', 'execute'),
  'authenticated cannot execute it');
select t.ok(exists (
  select 1 from pg_trigger tg
   where tg.tgrelid = 'auth.sessions'::regclass and tg.tgfoid = 'public.clear_session_ip()'::regprocedure
     and not tg.tgisinternal
     and (tg.tgtype & 1) = 1   -- for each row
     and (tg.tgtype & 2) = 2   -- before
     and (tg.tgtype & 4) = 4   -- insert
     and (tg.tgtype & 16) = 16 -- update
), 'trigger is before insert or update for each row on auth.sessions');

-- AC 1: sign-in. Supabase Auth inserts the session as supabase_auth_admin with the real ip and user agent.
set session authorization supabase_auth_admin;
insert into auth.sessions (id, user_id, ip, user_agent)
  values ('00000000-0000-0000-0000-000000167001', '00000000-0000-0000-0000-0000000000c1', '203.0.113.7', 'Expo/1.0 iPhone');
reset session authorization;
select t.ok((select ip is null and user_agent is null from auth.sessions
  where id = '00000000-0000-0000-0000-000000167001'), 'sign-in: the new session has no ip and no user agent');

-- AC 2: refresh. The update keeps ip / user agent null and still changes the other columns.
set session authorization supabase_auth_admin;
update auth.sessions set ip = '198.51.100.9', user_agent = 'Expo/1.0 Android', refreshed_at = '2026-11-19 10:00',
  updated_at = '2026-11-19 10:00+00' where id = '00000000-0000-0000-0000-000000167001';
reset session authorization;
select t.ok((select ip is null and user_agent is null from auth.sessions
  where id = '00000000-0000-0000-0000-000000167001'), 'refresh: ip and user agent stay null');
select t.eq((select refreshed_at from auth.sessions where id = '00000000-0000-0000-0000-000000167001'),
  '2026-11-19 10:00'::timestamp, 'refresh: refreshed_at is updated normally');

-- AC 3: a session stored before the migration (trigger off) is cleared by the migration's update, and the row stays.
alter table auth.sessions disable trigger clear_session_ip;
insert into auth.sessions (id, user_id, ip, user_agent)
  values ('00000000-0000-0000-0000-000000167002', t.id('S2'), '192.0.2.1', 'Old/1.0');
alter table auth.sessions enable trigger clear_session_ip;
select t.ok((select ip is not null from auth.sessions where id = '00000000-0000-0000-0000-000000167002'),
  'setup: an old session holds an ip');
update auth.sessions set ip = null, user_agent = null where ip is not null or user_agent is not null;
select t.ok((select ip is null and user_agent is null from auth.sessions
  where id = '00000000-0000-0000-0000-000000167002'), 'existing session: ip and user agent cleared');
select t.eq((select count(*) from auth.sessions where ip is not null or user_agent is not null), 0::bigint,
  'no session holds an ip or user agent');
select t.eq((select count(*) from auth.sessions), 2::bigint, 'existing sessions are kept (nobody signed out)');

-- AC 4: sign-out deletes the session; deleting the account cascades to its sessions.
set session authorization supabase_auth_admin;
delete from auth.sessions where id = '00000000-0000-0000-0000-000000167001';
reset session authorization;
select t.ok(not exists (select 1 from auth.sessions where id = '00000000-0000-0000-0000-000000167001'),
  'sign-out still removes the session');
delete from auth.users where id = t.id('S2');
select t.ok(not exists (select 1 from auth.sessions where user_id = t.id('S2')),
  'deleting the account still removes its sessions');

-- Signed-in users can't read auth.sessions.
select t.ok(not has_table_privilege('authenticated', 'auth.sessions', 'select'), 'authenticated cannot read auth.sessions');
select t.ok(not has_table_privilege('anon', 'auth.sessions', 'select'), 'anon cannot read auth.sessions');
