-- ARU-146: workspaces, part 2. Rules under test: supabase/migrations/0060_workspace_signup.sql.
-- Workspace "Sham" (the first, migrated) holds the usual fixture (t.seed()). Sign-ups are inserts into auth.users with
-- the user data the app sends; "through Supabase Auth" runs them as the role supabase_auth_admin, as GoTrue does.
select t.seed();

create function t.u(n text) returns uuid language sql immutable as $$ select md5('aru146' || n)::uuid $$;
grant execute on function t.u(text) to anon, authenticated;
create function t.ulogin(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.u(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.ulogin(text) to anon, authenticated;

-- GoTrue's database role.
create role supabase_auth_admin nologin;
grant usage on schema auth, t to supabase_auth_admin;
grant insert, select on auth.users to supabase_auth_admin;
grant execute on all functions in schema t to supabase_auth_admin;

-- A sign-up through Supabase Auth: errcode | hint, or 'no error'.
create function pg_temp.signup(who text, meta jsonb) returns text language plpgsql as $$
declare code text; hint text;
begin
  set session authorization supabase_auth_admin;
  insert into auth.users (id, email, raw_user_meta_data) values (t.u(who), who || '@x.test', meta);
  reset session authorization;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  reset session authorization;
  return code || ' | ' || coalesce(hint, '');
end $$;

create function t.ws1() returns uuid language sql security definer as $$ select id from public.workspaces order by created_at, id limit 1 $$;
grant execute on function t.ws1() to anon, authenticated;
create function pg_temp.users() returns bigint language sql as $$ select count(*) from auth.users $$;
create function pg_temp.workspaces() returns bigint language sql as $$ select count(*) from workspaces $$;

-- AC 7: the migrated workspace got a code; every code has the format.
select t.eq((select count(*) from workspace_invite_codes c join workspaces w on w.id = c.id where w.name = 'Sham'),
  1::bigint, 'AC7 the existing workspace got a code in the migration');
select t.ok(not exists (select 1 from workspace_invite_codes where code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  'AC7 codes are 8 characters from the alphabet');

-- AC 2: create a workspace.
select t.eq(pg_temp.signup('tw', '{"full_name":"Tia","workspace_name":"  My school  "}'), 'no error', 'AC2 create a workspace');
select t.eq((select w.name from profiles p join workspaces w on w.id = p.workspace_id where p.id = t.u('tw')), 'My school',
  'AC2 the workspace has the trimmed name');
select t.eq((select role::text || '/' || access_status::text from profiles where id = t.u('tw')), 'teacher/approved',
  'AC2 the creator is its teacher, approved at once');
select t.eq((select count(*) from workspace_invite_codes c join profiles p on p.workspace_id = c.id where p.id = t.u('tw')),
  1::bigint, 'AC2/AC7 the new workspace has one code');
select t.ulogin('tw');
select t.eq((select count(*) from profiles), 1::bigint, 'AC2 the new teacher sees only themselves');
select t.eq((select count(*) from courses), 0::bigint, 'AC2 and no course of another workspace');
select t.eq((select count(*) from workspace_invite_codes), 0::bigint, 'AC9 even the teacher reads codes only through the function');
select t.eq((select name from my_workspace_invite()), 'My school', 'AC8 the teacher reads the name');
select t.ok((select invite_code from my_workspace_invite()) ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'AC8 and the code');
reset role;

select t.eq(pg_temp.signup('tw2', '{"full_name":"Two","workspace_name":"My school"}'), 'no error', 'edge: same name again is allowed');
select t.ok((select count(distinct c.code) from workspace_invite_codes c join workspaces w on w.id = c.id
  where w.name = 'My school') = 2, 'edge: two workspaces with one name have different codes');

select t.eq(pg_temp.signup('n80', jsonb_build_object('full_name', 'N', 'workspace_name', repeat('a', 80))), 'no error',
  'AC2 80 characters are accepted');
select t.eq(pg_temp.workspaces(), 4::bigint, 'four workspaces so far');
select t.eq(pg_temp.signup('n81', jsonb_build_object('full_name', 'N', 'workspace_name', repeat('a', 81))),
  '22023 | sham:workspace_name_invalid', 'AC2 81 characters are refused');
select t.eq(pg_temp.signup('nblank', '{"full_name":"N","workspace_name":"   "}'), '22023 | sham:workspace_name_invalid',
  'AC2 a blank name is refused');
select t.ok(not exists (select 1 from auth.users where id in (t.u('n81'), t.u('nblank'))), 'AC2 no user for a refused name');
select t.eq(pg_temp.workspaces(), 4::bigint, 'AC2 and no workspace');

-- AC 3: join with a code (any case, spaces around it).
create function pg_temp.code(who text) returns text language sql as $$
  select c.code from workspace_invite_codes c join profiles p on p.workspace_id = c.id where p.id = t.u(who) $$;
select t.eq(pg_temp.signup('js', jsonb_build_object('full_name', 'Jo', 'invite_code', '  ' || lower(pg_temp.code('tw')) || ' ')),
  'no error', 'AC3/AC4 join with the code in lower case and spaces around it');
select t.eq((select role::text || '/' || access_status::text from profiles where id = t.u('js')), 'student/pending',
  'AC3 a student waiting for approval');
select t.eq((select workspace_id from profiles where id = t.u('js')), (select workspace_id from profiles where id = t.u('tw')),
  'AC3 in the code''s workspace');
select t.ulogin('tw');
select t.eq((select count(*) from access_requests() where id = t.u('js')), 1::bigint, 'AC3 the request is in its teacher''s Requests');
reset role;
select t.login('T');
select t.eq((select count(*) from access_requests() where id = t.u('js')), 0::bigint, 'AC3 and not in another teacher''s');
reset role;

-- AC 10: only that workspace's teacher is the New accounts recipient; a new workspace has none.
select t.eq((select string_agg(user_id::text, ',') from new_account_notification(t.u('js'))), t.u('tw')::text,
  'AC10 only the joined workspace''s teacher gets New accounts');
select t.eq((select count(*) from new_account_notification(t.u('tw'))), 0::bigint, 'AC10 creating a workspace notifies nobody');

-- AC 4: a wrong code.
select t.eq(pg_temp.signup('bad1', '{"full_name":"B","invite_code":"ZZZZZZZZ"}'), '22023 | sham:invite_code_unknown', 'AC4 a wrong code');
select t.eq(pg_temp.signup('bad2', '{"full_name":"B","invite_code":"ABC"}'), '22023 | sham:invite_code_unknown', 'AC4 a short code');
select t.eq(pg_temp.signup('bad3', '{"full_name":"B","invite_code":"   "}'), '22023 | sham:invite_code_unknown', 'AC4 only spaces');
select t.ok(not exists (select 1 from profiles where id in (t.u('bad1'), t.u('bad2'), t.u('bad3'))), 'AC4 no profile');
select t.ok(not exists (select 1 from auth.users where id in (t.u('bad1'), t.u('bad2'), t.u('bad3'))), 'AC4 no user');

-- AC 5: neither (or both) through Supabase Auth.
select t.eq(pg_temp.signup('old', '{"full_name":"Old build"}'), '22023 | sham:update_app', 'AC5 no choice is refused');
select t.eq(pg_temp.signup('nul', null), '22023 | sham:update_app', 'AC5 no user data at all is refused');
select t.ok(not exists (select 1 from profiles where id in (t.u('old'), t.u('nul'))), 'AC5 nothing lands in "Sham"');
select t.eq(pg_temp.signup('both', jsonb_build_object('full_name', 'B', 'workspace_name', 'X', 'invite_code', pg_temp.code('tw'))),
  '22023 | sham:workspace_choice_both', 'AC5 both a name and a code are refused');
select t.eq(pg_temp.workspaces(), 4::bigint, 'AC5 no workspace was made by refused sign-ups');

-- Admin inserts (SQL Editor, these tests) with no choice keep ARU-145's rule.
insert into auth.users (id, email, raw_user_meta_data) values (t.u('admin'), 'admin@x.test', '{"full_name":"Admin made"}');
select t.eq((select workspace_id from profiles where id = t.u('admin')), signup_workspace(), 'admin insert joins the oldest workspace');

-- AC 9: nobody else reads a code.
select t.login('S1');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'AC9 a student gets no code');
select t.eq((select count(*) from workspace_invite_codes), 0::bigint, 'AC9 a student reads no row of the codes table');
select t.ok(not exists (select 1 from information_schema.columns where table_name = 'workspaces' and column_name ilike '%code%'),
  'AC9 workspaces has no code column');
reset role;
select t.login('M');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'AC9 a mentor gets no code');
reset role;
select t.ulogin('js');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'AC9 a waiting account gets no code');
reset role;
update profiles set access_status = 'rejected' where id = t.u('js');
select t.ulogin('js');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'AC9 a declined account gets no code');
reset role;
create temp table expected_code as select code from workspace_invite_codes where id = t.ws1();
grant select on expected_code to authenticated;
select t.login('T');
select t.ok((select invite_code from my_workspace_invite()) = (select code from expected_code),
  'AC9 teacher T reads only their own workspace''s code');
reset role;
select t.login(null);
select t.throws('select * from workspace_invite_codes', '42501', 'AC9 signed out: no codes');
select t.throws('select * from my_workspace_invite()', '42501', 'AC9 signed out: no function');
reset role;

-- AC 7: unique codes, also for many workspaces.
insert into workspaces (name) select 'W' || g from generate_series(1, 50) g;
select t.eq((select count(*) from workspace_invite_codes), (select count(distinct code) from workspace_invite_codes),
  'AC7 50 more workspaces: all codes unique');
select t.eq((select count(*) from workspace_invite_codes), pg_temp.workspaces(), 'AC7 every workspace has exactly one code');
select t.throws($$update workspace_invite_codes set code = (select code from workspace_invite_codes order by id limit 1)
  where id = (select id from workspace_invite_codes order by id desc limit 1)$$,
  '23505', 'AC7 a duplicate code is a unique violation');
