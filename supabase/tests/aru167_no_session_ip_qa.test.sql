-- ARU-167 QA: the clear_session_ip() trigger on auth.sessions (0068_no_session_ip.sql), beyond the dev tests.
select t.seed();
-- supabase_auth_admin can't use schema t, so it reads the fixture ids from here.
create table public.qa_ids as select x.n, t.id(x.n) as id from unnest(array['T','M','N','S1']) x(n);
grant select on public.qa_ids to supabase_auth_admin;

-- AC 5: the function lives in public, its search_path is fixed, and nobody can call it directly.
select t.eq((select n.nspname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'clear_session_ip'), 'public', 'AC 5: clear_session_ip() is in public');
select t.eq((select count(*) from pg_proc where proname = 'clear_session_ip'), 1::bigint,
  'AC 5: exactly one clear_session_ip() function');
select t.ok(not has_function_privilege('public', 'public.clear_session_ip()', 'execute'),
  'AC 5: PUBLIC cannot execute clear_session_ip()');
select t.eq((select count(*) from pg_trigger where tgrelid = 'auth.sessions'::regclass and not tgisinternal), 1::bigint,
  'AC 5: one trigger on auth.sessions (no extra job or trigger)');
select t.ok((select tgenabled = 'O' from pg_trigger where tgname = 'clear_session_ip'), 'AC 5: the trigger is enabled');

-- AC 1 for every role: a session insert with real values stores nulls, also when reading it back with RETURNING.
set session authorization supabase_auth_admin;
create temp table qa_ret as
  with r as (
    insert into auth.sessions (user_id, ip, user_agent) values
      ('00000000-0000-0000-0000-0000000000c1', '203.0.113.1', 'Sham/1.0 (iPhone; iOS 18)')
    returning ip, user_agent)
  select * from r;
reset session authorization;
select t.ok((select ip is null and user_agent is null from qa_ret), 'AC 1: RETURNING shows no ip or user agent');

set session authorization supabase_auth_admin;
insert into auth.sessions (user_id, ip, user_agent)
  select id, '2001:db8::1'::inet, 'Mozilla/5.0' from public.qa_ids where n in ('T', 'M', 'S1');
reset session authorization;
select t.eq((select count(distinct user_id) from auth.sessions where user_id in (t.id('T'), t.id('M'), t.id('S1'))), 3::bigint,
  'AC 1: teacher, mentor and student each have a session');
select t.eq((select count(*) from auth.sessions where ip is not null or user_agent is not null), 0::bigint,
  'AC 1: no session holds an ip (IPv4 or IPv6) or a user agent');

-- AC 1: an empty-string user agent is not kept either (null, per analysis note 1).
set session authorization supabase_auth_admin;
insert into auth.sessions (user_id, ip, user_agent) select id, '10.0.0.1', '' from public.qa_ids where n = 'N';
reset session authorization;
select t.ok((select user_agent is null and ip is null from auth.sessions where user_id = t.id('N')),
  'AC 1: an empty user agent is stored as null');

-- AC 2: a refresh that doesn't touch ip / user_agent works and keeps them null; one setting only ip also stays null.
set session authorization supabase_auth_admin;
update auth.sessions set refreshed_at = '2026-11-19 12:00' where user_id = (select id from public.qa_ids where n = 'T');
update auth.sessions set ip = '198.51.100.2' where user_id = (select id from public.qa_ids where n = 'M');
update auth.sessions set user_agent = 'Expo/2.0' where user_id = (select id from public.qa_ids where n = 'S1');
reset session authorization;
select t.eq((select refreshed_at from auth.sessions where user_id = t.id('T')), '2026-11-19 12:00'::timestamp,
  'AC 2: refresh updates refreshed_at');
select t.eq((select count(*) from auth.sessions where ip is not null or user_agent is not null), 0::bigint,
  'AC 2: updates setting only ip or only user agent still store nulls');

-- The trigger also applies to the table owner (SQL Editor): no bypass by role.
update auth.sessions set ip = '192.0.2.50', user_agent = 'curl/8' where user_id = t.id('T');
select t.ok((select ip is null and user_agent is null from auth.sessions where user_id = t.id('T')),
  'an owner / SQL Editor update also stores nulls');

-- AC 3: re-run the migration's clearing statement exactly as written in 0068 (idempotent, keeps rows).
alter table auth.sessions disable trigger clear_session_ip;
update auth.sessions set ip = '192.0.2.9', user_agent = 'Old' where user_id = t.id('M');
alter table auth.sessions enable trigger clear_session_ip;
select t.eq(t.affected('update auth.sessions set ip = null, user_agent = null where ip is not null or user_agent is not null'),
  1::bigint, 'AC 3: the clearing statement touches only rows that hold a value');
select t.eq((select count(*) from auth.sessions), 5::bigint, 'AC 3: all sessions kept');
select t.eq(t.affected('update auth.sessions set ip = null, user_agent = null where ip is not null or user_agent is not null'),
  0::bigint, 'AC 3: running it again changes nothing');

-- Access: signed-in roles and anon can't read, change or call anything here.
select t.login('S1');
select t.throws('select * from auth.sessions', '42501', 'student cannot read auth.sessions');
select t.throws('select public.clear_session_ip()', '42501', 'student cannot call clear_session_ip()');
reset role;
select t.login('T');
select t.throws('update auth.sessions set ip = null', '42501', 'teacher cannot update auth.sessions');
select t.throws('select public.clear_session_ip()', '42501', 'teacher cannot call clear_session_ip()');
reset role;
select t.login(null);
select t.throws('select public.clear_session_ip()', '42501', 'anon cannot call clear_session_ip()');
reset role;

-- AC 4: deleting a teacher-workspace account still cascades its sessions.
delete from auth.users where id = t.id('S1');
select t.ok(not exists (select 1 from auth.sessions where user_id = t.id('S1')), 'AC 4: account deletion removes sessions');

-- No public table has an ip / user agent column, or an inet / cidr column, after all migrations (AC 7, 9 live check).
select t.eq((select count(*) from information_schema.columns c
  where c.table_schema = 'public'
    and (lower(c.column_name) in ('ip', 'ip_address', 'user_agent') or c.udt_name in ('inet', 'cidr', '_inet', '_cidr'))),
  0::bigint, 'AC 9: no IP-like column in public after every migration');
