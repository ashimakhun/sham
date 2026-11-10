-- ARU-146: sign-up creates or joins a workspace; the invite code. Rules under test:
-- supabase/migrations/0060_workspace_signup.sql. The fixture's workspace "Sham" (teacher T) plus workspaces made here.
select t.seed();

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; msg text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, msg = message_text, hint = pg_exception_hint;
  return concat_ws(' | ', code, msg, hint);
end $$;
-- A sign-up as Supabase Auth makes it: an insert into auth.users as supabase_auth_admin.
create function pg_temp.signup(who text, meta jsonb) returns text language plpgsql as $$
declare code text; msg text; hint text; result text := 'no error';
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (md5('aru146' || who)::uuid, who || '@x.test', meta);
  exception when others then
    get stacked diagnostics code = returned_sqlstate, msg = message_text, hint = pg_exception_hint;
    result := concat_ws(' | ', code, msg, hint);
  end;
  execute 'reset session authorization';
  return result;
end $$;
create function pg_temp.u(who text) returns uuid language sql immutable as $$ select md5('aru146' || who)::uuid $$;
create function pg_temp.login(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
create function pg_temp.code_of(ws uuid) returns text language sql as $$
  select code from public.workspace_invite_codes where workspace = ws $$;
create function pg_temp.ws_of(who text) returns uuid language sql as $$
  select workspace_id from public.profiles where id = pg_temp.u(who) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- AC 7: the existing workspace got a code in the migration.
select t.ok(pg_temp.code_of(signup_workspace()) ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'AC7 workspace "Sham" has a code');
select t.eq((select count(*) from workspaces w where not exists (select 1 from workspace_invite_codes c where c.workspace = w.id)),
  0::bigint, 'AC7 every workspace has a code');

-- AC 2: create a workspace.
select t.eq(pg_temp.signup('ta', '{"full_name":"Tia","workspace_name":"  My school  "}'), 'no error', 'AC2 create a workspace');
select t.eq((select name from workspaces where id = pg_temp.ws_of('ta')), 'My school', 'AC2 the name is trimmed');
select t.ok(pg_temp.ws_of('ta') <> signup_workspace(), 'AC2 a new workspace, not "Sham"');
select t.eq((select role::text || '/' || access_status::text from profiles where id = pg_temp.u('ta')), 'teacher/approved',
  'AC2 its teacher, approved');
select t.ok(pg_temp.code_of(pg_temp.ws_of('ta')) ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'AC7 the new workspace has a code');
select t.eq((select count(*) from new_account_notification(pg_temp.u('ta'))), 0::bigint, 'AC10 creating sends no New accounts');
select t.eq(pg_temp.signup('tb', format('{"full_name":"Tom","workspace_name":"%s"}', repeat('é', 80))::jsonb), 'no error',
  'AC2 80 characters accepted');
select t.eq(pg_temp.signup('tc', '{"full_name":"Tim","workspace_name":"My school"}'), 'no error', 'edge: same name allowed');
select t.ok(pg_temp.code_of(pg_temp.ws_of('tc')) <> pg_temp.code_of(pg_temp.ws_of('ta')), 'edge: same name, different codes');

-- AC 2: a bad name is refused; nothing is created.
select count(*) as before from workspaces \gset
select t.eq(pg_temp.signup('x1', format('{"workspace_name":"%s"}', repeat('a', 81))::jsonb),
  '23514 | Workspace name must be 1 to 80 characters. | sham:workspace_name_length', 'AC2 81 characters refused');
select t.eq(pg_temp.signup('x2', '{"workspace_name":"   "}'),
  '23514 | Workspace name must be 1 to 80 characters. | sham:workspace_name_length', 'AC2 blank refused');
select t.eq((select count(*) from workspaces), :before::bigint, 'AC2 no workspace made by a refused sign-up');
select t.eq((select count(*) from auth.users where id in (pg_temp.u('x1'), pg_temp.u('x2'))), 0::bigint, 'AC2 no user either');

-- AC 3: join with a code (spaces and letter case ignored).
select t.eq(pg_temp.signup('j1', format('{"full_name":"Jo","invite_code":"  %s "}', lower(pg_temp.code_of(pg_temp.ws_of('ta'))))::jsonb),
  'no error', 'AC3 join with the code in lower case, spaces around');
select t.eq(pg_temp.ws_of('j1'), pg_temp.ws_of('ta'), 'AC3 in that workspace');
select t.eq((select role::text || '/' || access_status::text from profiles where id = pg_temp.u('j1')), 'student/pending',
  'AC3 a waiting student');
select t.eq((select array_agg(user_id) from new_account_notification(pg_temp.u('j1'))), array[pg_temp.u('ta')],
  'AC10 only that workspace''s teacher is notified');
select pg_temp.login('ta');
select t.eq((select count(*) from access_requests() where id = pg_temp.u('j1')), 1::bigint, 'AC3 the request is in its teacher''s list');
reset role;
select t.login('T');
select t.eq((select count(*) from access_requests() where id = pg_temp.u('j1')), 0::bigint, 'AC3 not in another teacher''s list');
reset role;
select t.eq(pg_temp.signup('j2', format('{"invite_code":"%s"}', pg_temp.code_of(signup_workspace()))::jsonb), 'no error',
  'AC3 join "Sham" with its code');
select t.eq(pg_temp.ws_of('j2'), signup_workspace(), 'AC3 in "Sham"');

-- AC 4: a wrong code; nothing is created.
select t.eq(pg_temp.signup('w1', '{"invite_code":"ABCDEFGH"}'),
  'P0002 | No workspace has this invite code. | sham:invite_code_unknown', 'AC4 an unknown code');
select t.eq(pg_temp.signup('w2', '{"invite_code":"   "}'),
  'P0002 | No workspace has this invite code. | sham:invite_code_unknown', 'AC4 only spaces');
select t.eq(pg_temp.signup('w3', format('{"invite_code":"%s"}', left(pg_temp.code_of(signup_workspace()), 7))::jsonb),
  'P0002 | No workspace has this invite code. | sham:invite_code_unknown', 'AC4 seven characters');
select t.eq((select count(*) from auth.users where id in (pg_temp.u('w1'), pg_temp.u('w2'), pg_temp.u('w3'))), 0::bigint,
  'AC4 no user');
select t.eq((select count(*) from profiles where id in (pg_temp.u('w1'), pg_temp.u('w2'), pg_temp.u('w3'))), 0::bigint,
  'AC4 no profile');

-- AC 5: no choice (an older app, a direct Auth API call), or both: refused.
select t.eq(pg_temp.signup('n1', '{"full_name":"Old App"}'),
  '22023 | Update the app to create an account. | sham:signup_update_app', 'AC5 neither a name nor a code');
select t.eq(pg_temp.signup('n2', null), '22023 | Update the app to create an account. | sham:signup_update_app',
  'AC5 no user data at all');
select t.eq(pg_temp.signup('n3', format('{"workspace_name":"X","invite_code":"%s"}', pg_temp.code_of(signup_workspace()))::jsonb),
  '22023 | Update the app to create an account. | sham:signup_update_app', 'AC5 both: refused');
select t.eq((select count(*) from profiles where id in (pg_temp.u('n1'), pg_temp.u('n2'), pg_temp.u('n3'))), 0::bigint,
  'AC5 no profile lands in "Sham"');
-- The admin (SQL Editor) can still add an auth user without a choice: it joins the oldest workspace, as in 0059.
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u('adm'), 'adm@x.test', '{"full_name":"Added"}');
select t.eq(pg_temp.ws_of('adm'), signup_workspace(), 'AC5 an admin insert still joins the oldest workspace');

-- AC 7: codes are unique, in format, and the database makes them.
insert into workspaces (name) select 'W' || g from generate_series(1, 50) g;
select t.eq((select count(distinct code) from workspace_invite_codes), (select count(*) from workspaces), 'AC7 50 more workspaces, all codes unique');
select t.ok((select bool_and(code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$') from workspace_invite_codes), 'AC7 every code in format');
select t.ok(pg_temp.err(format('insert into workspace_invite_codes (workspace, code) values (%L, %L)',
  (select id from workspaces where name = 'W1'), 'ZZZZZZZZ')) like '23505 | duplicate key value violates unique constraint "workspace_invite_codes_pkey"%',
  'AC7 one code per workspace');
delete from workspace_invite_codes where workspace = (select id from workspaces where name = 'W1');
select t.ok(pg_temp.err(format('insert into workspace_invite_codes (workspace, code) values (%L, %L)',
  (select id from workspaces where name = 'W1'), pg_temp.code_of(signup_workspace()))) like '23505 | duplicate key value violates unique constraint "workspace_invite_codes_code"%',
  'AC7 a duplicate code is a unique violation');
select t.ok(pg_temp.err(format('insert into workspace_invite_codes (workspace, code) values (%L, %L)',
  (select id from workspaces where name = 'W1'), 'abcdefgh')) like '23514 %', 'AC7 lower case refused');
select t.ok(pg_temp.err(format('insert into workspace_invite_codes (workspace, code) values (%L, %L)',
  (select id from workspaces where name = 'W1'), 'ABCDEFG0')) like '23514 %', 'AC7 0 is not in the alphabet');

-- AC 8 / AC 9: only the workspace's teacher reads the code. (Codes read as the admin first: app users can't.)
select pg_temp.code_of(pg_temp.ws_of('ta')) as ta_code, pg_temp.code_of(signup_workspace()) as sham_code \gset
select pg_temp.login('ta');
select t.eq((select name || '/' || invite_code from my_workspace_invite()), 'My school/' || :'ta_code',
  'AC8 the teacher reads their workspace name and code');
select t.eq((select count(*) from workspace_invite_codes), 0::bigint, 'AC9 the table itself returns no row, also to the teacher');
select t.ok(pg_temp.err(format('insert into workspace_invite_codes values (%L, %L)', pg_temp.ws_of('ta'), 'ZZZZZZZZ')) like '42501 %', 'AC9 nor can it be written');
reset role;
select t.login('T');
select t.eq((select count(*) from my_workspace_invite() where invite_code = :'ta_code'), 0::bigint,
  'AC9 another workspace''s teacher doesn''t get it');
select t.eq((select invite_code from my_workspace_invite()), :'sham_code', 'AC8 T reads "Sham"''s code');
reset role;
-- j1 is waiting; accept j2 in "Sham" for the approved-student case, decline nobody (j1 stays waiting).
update profiles set access_status = 'approved' where id = pg_temp.u('j2');
select pg_temp.login('j1');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'AC9 a waiting account gets no code');
reset role;
select pg_temp.login('j2');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'AC9 an approved student gets no code');
select t.eq((select name from workspaces), 'Sham', 'AC9 the student reads the workspace name');
select t.ok(not exists (select 1 from information_schema.columns where table_name = 'workspaces' and column_name ilike '%code%'),
  'AC9 workspaces has no code column');
reset role;
select t.login('M');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'AC9 a mentor gets no code');
reset role;
update profiles set access_status = 'rejected' where id = pg_temp.u('j1');
select pg_temp.login('j1');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'AC9 a declined account gets no code');
reset role;
select t.login(null);
select t.ok(pg_temp.err('select * from my_workspace_invite()') like '42501 %', 'AC9 anon can''t call it');
select t.eq((select count(*) from workspace_invite_codes), 0::bigint, 'AC9 anon reads no code');
reset role;
