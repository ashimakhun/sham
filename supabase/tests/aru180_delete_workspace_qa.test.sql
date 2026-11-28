-- ARU-180 QA: Delete workspace, part 1. Rules under test: supabase/migrations/0077_deactivated_status.sql and
-- 0078_delete_workspace.sql. Adds to aru180_delete_workspace.test.sql: the real permission errors for the app roles,
-- the teacher guard outside delete_workspace(), a teacher who owns a course, a second and a third workspace deleted
-- afterwards (earlier deactivations untouched), a workspace with only the teacher, the freed username and the dead
-- invite code at sign-up, and more refused reads / writes for a deactivated account.
-- W1: the fixture (t.seed()) plus a course owned by the teacher and a pending account P. W2: teacher XT, student XS.
-- W3: teacher ZT alone.
select t.seed();
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

create function t.q(n text) returns uuid language sql immutable as $$ select md5('aru180qa' || n)::uuid $$;
grant execute on function t.q(text) to anon, authenticated, service_role;
create function t.qlogin(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.q(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.qlogin(text) to anon, authenticated;

-- What a statement raises: errcode | hint (or 'no error').
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return concat_ws(' | ', code, nullif(hint, ''));
end $$;
grant execute on function pg_temp.err(text) to authenticated, anon, service_role;

-- A sign-up as Supabase Auth makes it (as in aru164): errcode | hint, or 'ok'.
create function pg_temp.signup(id uuid, uname text, meta jsonb) returns text language plpgsql as $$
declare code text; hint text; result text := 'ok';
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (id, uname || '@users.sham.invalid',
              jsonb_build_object('terms_version', 1, 'username', uname, 'full_name', 'New ' || uname) || meta);
  exception when others then
    get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
    result := concat_ws(' | ', code, hint);
  end;
  execute 'reset session authorization';
  return result;
end $$;

create temp table ws1 as select signup_workspace() as id;
grant select on ws1 to authenticated, anon, service_role;

-- W1 extras: the teacher owns a course (in a discipline); a pending account; the teacher's username and invite code.
set session_replication_role = replica;
insert into disciplines (id, name, created_by, workspace_id) values (t.q('TD'), 'Teacher discipline', t.id('T'), (select id from ws1));
insert into courses (id, title, created_by, discipline_id, workspace_id)
  values (t.q('TC'), 'Teacher course', t.id('T'), t.q('TD'), (select id from ws1));
set session_replication_role = origin;
insert into auth.users (id, email, raw_user_meta_data) values (t.q('P'), 'qp@x.test', '{"full_name":"Pat Pending"}');
insert into usernames (user_id, username) values (t.id('T'), 'tess.teacher'), (t.id('S1'), 'sam.student');
select set_config('qa.w1code', (select code from workspace_invite_codes where workspace = (select id from ws1)), false);

-- W2 and W3 (as the admin).
insert into workspaces (id, name, created_at) values (t.q('W2'), 'Second school', now()), (t.q('W3'), 'Solo', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.q('XT'), 'qxt@x.test', '{"full_name":"Xena Teacher"}'),
  (t.q('XS'), 'qxs@x.test', '{"full_name":"Xia Student"}'),
  (t.q('ZT'), 'qzt@x.test', '{"full_name":"Zed Teacher"}');
update profiles set workspace_id = t.q('W2'), access_status = 'approved' where id in (t.q('XT'), t.q('XS'));
update profiles set workspace_id = t.q('W3'), access_status = 'approved' where id = t.q('ZT');
update profiles set role = 'teacher' where id in (t.q('XT'), t.q('ZT'));
set session_replication_role = replica;
insert into courses (id, title, created_by, workspace_id) values (t.q('XC'), 'Second course', t.q('XT'), t.q('W2'));
insert into course_members (course_id, user_id, added_by, workspace_id) values (t.q('XC'), t.q('XS'), t.q('XT'), t.q('W2'));
set session_replication_role = origin;

select t.ok((select count(*) from workspace_invite_codes where workspace = (select id from ws1)) = 1
  and current_setting('qa.w1code') <> '', 'setup: W1 has an invite code');

-- 1. Roles and access: the app roles can't even call the service-role functions (a real call, not only the grant).
select t.login('T');
select t.eq(pg_temp.err(format('select delete_workspace(%L)', t.id('T'))), '42501',
  'access: the teacher can''t call delete_workspace() from the app');
select t.eq(pg_temp.err(format('select * from workspace_storage_objects(%L)', (select id from ws1))), '42501',
  'access: the teacher can''t list the workspace''s files from the app');
select t.eq(pg_temp.err(format('select * from workspace_deletion_target(%L)', t.id('T'))), '42501',
  'access: the teacher can''t call workspace_deletion_target() from the app');
select t.eq(t.affected(format('delete from profiles where id = %L', t.id('T'))), 0::bigint,
  'access: the teacher can''t delete their own profile row');
select t.login('S1');
select t.eq(pg_temp.err(format('select delete_workspace(%L)', t.id('T'))), '42501',
  'access: a student can''t call delete_workspace() for the teacher');
select t.login(null);
select t.eq(pg_temp.err(format('select delete_workspace(%L)', t.id('T'))), '42501',
  'access: anon can''t call delete_workspace()');
reset role;
select t.eq((select count(*) from pg_proc where proname = 'delete_workspace'), 1::bigint,
  'access: one delete_workspace(), taking only the teacher (no workspace parameter to point at another workspace)');

-- 2. A plain account deletion still refuses the teacher, even with the transaction flag naming another workspace or
-- set by hand for the teacher's own workspace while they still own a course.
select t.eq(pg_temp.err(format('delete from auth.users where id = %L', t.id('T'))), 'P0001 | sham:delete_teacher',
  'ARU-75: a plain deletion of the teacher is refused');
select t.eq(pg_temp.err(format($$select set_config('sham.deleting_workspace', %L, false); delete from auth.users where id = %L$$,
  t.q('W2'), t.id('T'))), 'P0001 | sham:delete_teacher', 'ARU-75: the flag for another workspace doesn''t let the teacher go');
select t.eq(pg_temp.err(format($$select set_config('sham.deleting_workspace', %L, false); delete from auth.users where id = %L$$,
  (select id from ws1), t.id('T'))), 'P0001 | sham:delete_teacher',
  'ARU-75: the flag alone doesn''t let a teacher who still owns a course go');
select set_config('sham.deleting_workspace', '', false);
select t.ok(exists (select 1 from auth.users where id = t.id('T')) and exists (select 1 from profiles where id = t.id('T')) and exists (select 1 from workspaces w join ws1 using (id)),
  'ARU-75: the teacher and W1 are still there');

-- 3. AC 2: the summary counts pending accounts (P) too: M, N, M2, S1, S2, S3, P = 7.
select t.login('T');
select t.eq((select other_accounts from workspace_deletion_summary()), 7, 'AC2 7 other accounts, the pending one included');
select t.qlogin('ZT');
select t.eq((select name || ' ' || other_accounts from workspace_deletion_summary()), 'Solo 0',
  'AC2 edge case: a workspace with only the teacher has 0 other accounts');
select t.qlogin('XT');
select t.eq((select name from workspace_deletion_summary()), 'Second school', 'AC2 each teacher sees only their own workspace');
reset role;

-- 4. Delete W1: the teacher owns a course and a discipline; the cascade isn't blocked (ARU-85 / ARU-83 helpers).
delete from storage.objects o using (select * from workspace_storage_objects((select id from ws1))) w
  where o.bucket_id = w.bucket_id and o.name = w.name;
set role service_role;
select t.lives(format('select delete_workspace(%L)', t.id('T')), 'AC5 deletion succeeds although the teacher owns a course');
reset role;
select t.eq((select count(*) from courses where id = t.q('TC')) + (select count(*) from disciplines where id = t.q('TD')),
  0::bigint, 'AC6 the teacher''s own course and discipline are gone');
select t.eq((select count(*) from profiles where access_status = 'deactivated'), 7::bigint, 'AC8 7 accounts deactivated');
select t.eq((select access_status::text from profiles where id = t.q('P')), 'deactivated', 'AC8 the pending account too');
select t.eq((select count(*) from profiles where workspace_id is null and access_status <> 'deactivated')
  + (select count(*) from profiles where workspace_id is not null and access_status = 'deactivated'), 0::bigint,
  'AC8 constraint holds for every row');
select t.eq((select count(*) from profiles where workspace_id in (t.q('W2'), t.q('W3'))), 3::bigint, 'AC6 W2 and W3 accounts untouched');
select t.eq((select count(*) from course_members where course_id = t.q('XC')), 1::bigint, 'AC6 W2''s course members untouched');

-- AC 8 constraint: an admin can't put a deactivated account back into a workspace without changing its status, and
-- can't take an approved account out of its workspace.
select t.eq(pg_temp.err(format('update profiles set workspace_id = %L where id = %L', t.q('W2'), t.id('S2'))), '23514',
  'AC8 constraint: a deactivated account with a workspace is refused');
select t.eq(pg_temp.err(format('update profiles set workspace_id = null where id = %L', t.q('XS'))), '23514',
  'AC8 constraint: an approved account without a workspace is refused');

-- 5. AC 7: the username is free; a new sign-up with it starts from nothing. W1's old invite code no longer works.
select t.eq(pg_temp.signup(t.q('NEWT'), 'tess.teacher', jsonb_build_object('workspace_name', 'Fresh school')), 'ok',
  'AC7 the freed username can sign up again');
select t.ok((select role::text = 'teacher' and access_status::text = 'approved' and workspace_id is not null
    and workspace_id <> (select id from ws1) from profiles where id = t.q('NEWT')), 'AC7 the new sign-up is a teacher of a new workspace');
select t.qlogin('NEWT');
select t.eq((select count(*) from profiles), 1::bigint, 'AC7 the new account sees only itself');
select t.eq((select count(*) from courses) + (select count(*) from disciplines) + (select count(*) from general_messages)
  + (select count(*) from materials), 0::bigint, 'AC7 the new account starts from nothing');
reset role;
select t.eq(pg_temp.signup(t.q('LATE'), 'late.joiner', jsonb_build_object('invite_code', current_setting('qa.w1code'))),
  'P0002 | sham:invite_code_unknown', 'AC6 the deleted workspace''s invite code is refused at sign-up');
select t.eq(pg_temp.signup(t.q('DUP'), 'sam.student', jsonb_build_object('workspace_name', 'Mine')),
  '23505 | sham:username_taken', 'AC8 a deactivated member keeps their username (still taken)');

-- 6. A deactivated account: more refused reads and writes.
select t.login('S1');
select t.ok(my_account_deactivated(), 'AC9 my_account_deactivated() is true for it');
select t.eq((select count(*) from profiles where id = t.id('S2')), 0::bigint, 'access: can''t read another deactivated account');
select t.eq((select count(*) from profiles where id = t.q('XS')), 0::bigint, 'access: can''t read another workspace''s account');
select t.eq((select count(*) from usernames), 1::bigint, 'access: reads only its own username');
select t.eq((select count(*) from workspace_invite_codes), 0::bigint, 'access: reads no invite code');
select t.eq((select count(*) from courses) + (select count(*) from course_members), 0::bigint, 'access: reads no W2 course');
select t.eq(pg_temp.err(format('update profiles set access_status = %L, workspace_id = %L where id = %L', 'approved', t.q('W2'), t.id('S1'))),
  '42501', 'access: can''t move itself into another workspace');
select t.ok(pg_temp.err(format('insert into course_members (course_id, user_id, workspace_id) values (%L, %L, %L)',
  t.q('XC'), t.id('S1'), t.q('W2'))) <> 'no error', 'access: can''t join a W2 course');
select t.ok(pg_temp.err(format('insert into homework (student_id, course_id, title, workspace_id) values (%L, %L, %L, %L)',
  t.id('S1'), t.q('XC'), 'sneak', t.q('W2'))) <> 'no error', 'access: can''t send homework into W2');
select t.eq(t.affected(format('update courses set title = %L where id = %L', 'Hacked', t.q('XC'))), 0::bigint,
  'access: can''t change a W2 course');
select t.eq(t.affected(format('delete from course_members where course_id = %L', t.q('XC'))), 0::bigint,
  'access: can''t delete W2 rows');
select t.eq((select count(*) from workspace_deletion_summary()), 0::bigint, 'access: no deletion summary for a deactivated account');
reset role;
select t.eq((select title from courses where id = t.q('XC')), 'Second course', 'access: the W2 course is unchanged');

-- A former mentor (deactivated) can't act as a mentor or as anyone's mentor.
select t.login('M');
select t.eq(my_role(), null::user_role, 'access: a deactivated mentor has no role');
select t.eq((select count(*) from profiles), 1::bigint, 'access: a deactivated mentor reads only its own profile');
reset role;

-- 7. A second deletion later (W2) leaves the earlier deactivated accounts exactly as they were.
create temp table w1_deactivated as
  select id, access_changed_at, role from profiles where access_status = 'deactivated';
delete from storage.objects o using (select * from workspace_storage_objects(t.q('W2'))) w
  where o.bucket_id = w.bucket_id and o.name = w.name;
set role service_role;
select t.lives(format('select delete_workspace(%L)', t.q('XT')), 'W2 deleted afterwards');
reset role;
select t.eq((select count(*) from profiles p join w1_deactivated d using (id)
  where p.access_status = 'deactivated' and p.access_changed_at = d.access_changed_at and p.role = d.role), 7::bigint,
  'the earlier deactivated accounts are untouched by a later deletion');
select t.eq((select access_status::text from profiles where id = t.q('XS')), 'deactivated', 'W2''s student is deactivated now');
select t.eq((select count(*) from profiles where id = t.q('XT')), 0::bigint, 'W2''s teacher is gone');
select t.eq((select count(*) from courses where id = t.q('XC')), 0::bigint, 'W2''s course is gone');
select t.ok(exists (select 1 from workspaces where id = t.q('W3')) and exists (select 1 from profiles where id = t.q('ZT')
  and access_status = 'approved'), 'W3 untouched');
select t.ok(exists (select 1 from profiles where id = t.q('NEWT') and access_status = 'approved'), 'the new sign-up untouched');

-- 8. Edge case: a workspace with only the teacher.
set role service_role;
select t.lives(format('select delete_workspace(%L)', t.q('ZT')), 'edge case: a workspace with only the teacher is deleted');
select t.eq(pg_temp.err(format('select delete_workspace(%L)', t.q('ZT'))), '42501 | sham:workspace_delete_teacher_only',
  'a second call for a deleted teacher changes nothing');
reset role;
select t.eq((select count(*) from workspaces where id = t.q('W3')) + (select count(*) from auth.users where id = t.q('ZT')),
  0::bigint, 'edge case: the solo workspace and its teacher are gone');
select t.eq((select count(*) from profiles where access_status = 'deactivated'), 8::bigint,
  'edge case: nobody new deactivated (7 from W1 + 1 from W2)');
