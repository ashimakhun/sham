-- ARU-154: signed-out visitors (anon, and public) can execute no security definer function in public, while signed-in
-- behaviour that uses my_role() / is_my_student() keeps working. Fix under test:
-- supabase/migrations/0063_revoke_anon_security_definer.sql.
select t.seed();

-- Every security definer function in public: anon can't execute it (this also covers public, which anon inherits).
select t.eq(
  (select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')),
  null::text, 'anon can execute no security definer function in public');

-- The four named in the bug, one by one.
select t.ok(not has_function_privilege('anon', 'public.handle_new_user()', 'execute'), 'anon: handle_new_user()');
select t.ok(not has_function_privilege('anon', 'public.homework_assignments_before_insert()', 'execute'),
  'anon: homework_assignments_before_insert()');
select t.ok(not has_function_privilege('anon', 'public.my_role()', 'execute'), 'anon: my_role()');
select t.ok(not has_function_privilege('anon', 'public.is_my_student(uuid)', 'execute'), 'anon: is_my_student(uuid)');

-- The trigger functions aren't callable by signed-in users either; the helpers RLS uses still are.
select t.ok(not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  'authenticated: no handle_new_user()');
select t.ok(not has_function_privilege('authenticated', 'public.homework_assignments_before_insert()', 'execute'),
  'authenticated: no homework_assignments_before_insert()');
select t.ok(has_function_privilege('authenticated', 'public.my_role()', 'execute'), 'authenticated keeps my_role()');
select t.ok(has_function_privilege('authenticated', 'public.is_my_student(uuid)', 'execute'),
  'authenticated keeps is_my_student(uuid)');

-- Signed-in behaviour unchanged: my_role() answers for the caller, and RLS that uses it still lets the teacher read.
select t.login('T');
select t.eq(my_role()::text, 'teacher', 'the teacher still gets their role from my_role()');
select t.ok((select count(*) from profiles) > 1, 'the teacher still reads profiles through RLS');
reset role;
select t.login('S1');
select t.eq(my_role()::text, 'student', 'a student still gets their role from my_role()');
reset role;

-- Sign-up still works: Supabase Auth inserts into auth.users as supabase_auth_admin, and the trigger runs regardless of
-- EXECUTE grants.
set session authorization supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-00000000f154', 'new154@x.test', '{"full_name": "New 154", "workspace_name": "WS 154"}');
reset session authorization;
select t.ok(exists (select 1 from profiles where id = '00000000-0000-0000-0000-00000000f154'),
  'sign-up still creates the profile (handle_new_user trigger)');
