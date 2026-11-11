-- QA ARU-154: gaps in aru154_anon_security_definer.test.sql. The dev test checks the privileges; this one makes the
-- real calls: signed-out (anon) and signed-in direct calls of the four functions, and the app paths that depend on them
-- still working after 0063: sign-up by workspace name and by invite code (handle_new_user), assigning homework as the
-- owner and the friendly refusal for a signed-out insert (homework_assignments_before_insert), and RLS reads that call
-- my_role() as the querying user.
select t.seed();

-- 1. Signed out: every call is refused with "permission denied" (42501), not an answer.
select t.login(null);
select t.throws('select public.my_role()', '42501', 'anon: my_role() refused');
select t.throws('select public.is_my_student(''' || t.id('S1') || ''')', '42501', 'anon: is_my_student() refused');
select t.throws('select public.handle_new_user()', '42501', 'anon: handle_new_user() refused');
select t.throws('select public.homework_assignments_before_insert()', '42501',
  'anon: homework_assignments_before_insert() refused');
reset role;

-- 2. Signed in: the trigger functions can't be called directly; the RLS helpers still answer.
select t.login('S1');
select t.throws('select public.handle_new_user()', '42501', 'authenticated: handle_new_user() refused');
select t.throws('select public.homework_assignments_before_insert()', '42501',
  'authenticated: homework_assignments_before_insert() refused');
select t.eq(public.my_role()::text, 'student', 'authenticated: my_role() still answers');
select t.ok(public.is_my_student(t.id('S2')) is not null, 'authenticated: is_my_student() still answers');
reset role;

-- 3. RLS that calls my_role() as the querying user: the teacher reads every homework, a student only their own.
select t.login('T');
select t.eq((select count(*) from homework), 3::bigint, 'teacher: RLS with my_role() reads all 3 homework');
reset role;
select t.login('S2');
select t.eq((select count(*) from homework), 0::bigint, 'student S2: reads none of S1''s homework');
reset role;
select t.login('S1');
select t.eq((select count(*) from homework), 3::bigint, 'student S1: reads their own 3 homework');
reset role;

-- 4. Assigning homework: the before-insert trigger still runs for the owner (it trims the title), and a signed-out
-- insert is still refused with 42501.
insert into course_meetings (id, course_id, starts_at, status, created_by)
  values (md5('qa154-meeting')::uuid, t.id('A'), now() - interval '1 day', 'completed', t.id('M'));
select t.login('M');
select t.lives(format(
  'insert into homework_assignments (id, meeting_id, course_id, title, created_by) values (%L, %L, %L, %L, %L)',
  md5('qa154-asg'), md5('qa154-meeting'), t.id('A'), '  Fractions  ', t.id('M')),
  'owner assigns homework (trigger runs without EXECUTE for the caller)');
reset role;
select t.eq((select title from homework_assignments where id = md5('qa154-asg')::uuid), 'Fractions',
  'the trigger ran: the title is trimmed');
insert into course_meetings (id, course_id, starts_at, status, created_by)
  values (md5('qa154-meeting2')::uuid, t.id('A'), now() - interval '1 day', 'completed', t.id('M'));
select t.login(null);
select t.throws(format(
  'insert into homework_assignments (id, meeting_id, course_id, title, created_by) values (%L, %L, %L, %L, %L)',
  md5('qa154-asg2'), md5('qa154-meeting2'), t.id('A'), 'X', t.id('M')),
  '42501', 'anon: assigning homework is still refused');
reset role;
select t.ok(not exists (select 1 from homework_assignments where id = md5('qa154-asg2')::uuid), 'nothing inserted');

-- 5. Sign-up through Supabase Auth (as supabase_auth_admin): by workspace name it creates a workspace and its teacher;
-- by invite code it joins as a waiting student. Both run handle_new_user() as a trigger.
set session authorization supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data)
  values (md5('qa154-create')::uuid, 'c154@x.test', '{"full_name": "Create 154", "workspace_name": "QA 154 school"}');
reset session authorization;
select t.eq((select role::text || '/' || access_status::text from profiles where id = md5('qa154-create')::uuid),
  'teacher/approved', 'sign-up by workspace name: approved teacher of the new workspace');

select set_config('t.code', (select c.code from workspace_invite_codes c join profiles p on p.workspace_id = c.workspace
  where p.id = t.id('T')), false);
set session authorization supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data)
  values (md5('qa154-join')::uuid, 'j154@x.test',
    json_build_object('full_name', 'Join 154', 'invite_code', lower(current_setting('t.code')))::jsonb);
reset session authorization;
select t.eq((select role::text || '/' || access_status::text from profiles where id = md5('qa154-join')::uuid),
  'student/pending', 'sign-up by invite code: waiting student');
select t.eq((select workspace_id from profiles where id = md5('qa154-join')::uuid),
  (select workspace_id from profiles where id = t.id('T')), 'joined the teacher''s workspace');

-- 6. Sweep: no security definer function in public is executable by anon or by public.
select t.eq(
  (select string_agg(p.oid::regprocedure::text, ', ' order by 1)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'execute')
        or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.grantee = 0 and a.privilege_type = 'EXECUTE'))),
  null::text, 'no security definer function in public is executable by anon or PUBLIC');
