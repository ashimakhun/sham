-- ARU-145: workspaces, part 1. Rules under test: supabase/migrations/0059_workspaces.sql.
-- Workspace "Sham" (the first, migrated) holds the usual fixture (t.seed(): teacher T, mentors M, N, M2, students
-- S1-S3, courses A and B). A second workspace W2 has teacher XT, mentor XM (owns course XC, discipline XD), student
-- XS (a listener of XC) and a waiting account XP, with homework (photo), a meeting, chat, Blog post, like, PDF,
-- payment request (proof), general chat and Telegram links.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));

create function t.x(n text) returns uuid language sql immutable as $$ select md5('aru145' || n)::uuid $$;
grant execute on function t.x(text) to anon, authenticated;
-- Sign in as a W2 account (t.login() knows only the fixture's names).
create function t.xlogin(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.x(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.xlogin(text) to anon, authenticated;
-- The first workspace's id, for statements run as an app user.
create function t.ws1() returns uuid language sql security definer as $$ select id from public.workspaces order by created_at, id limit 1 $$;
grant execute on function t.ws1() to anon, authenticated;
-- Moves an account, as any security definer function would (for AC 3).
create function t.move_profile(who uuid, ws uuid) returns void language sql security definer as $$
  update public.profiles set workspace_id = ws where id = who $$;
grant execute on function t.move_profile(uuid, uuid) to authenticated;

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
grant execute on function pg_temp.err(text) to authenticated, anon;

-- AC 1: the migration made one workspace "Sham" that holds every existing account and row.
select t.eq((select string_agg(name, ',') from workspaces), 'Sham', 'AC1 one workspace "Sham"');
select t.ok(not exists (select 1 from profiles where workspace_id is distinct from signup_workspace()),
  'AC1 every account is in it');
select t.ok((select bool_and(is_nullable = 'NO') from information_schema.columns where table_schema = 'public'
  and column_name = 'workspace_id'), 'AC1 every workspace_id is not null');
select t.ok(not exists (
  select 1 from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'workspace_id'
    and not exists (select 1 from pg_indexes i where i.tablename = c.table_name and i.indexdef like '%(workspace_id)%')),
  'data: every workspace_id is indexed');

-- AC 11: these stay global.
select t.eq((select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id'
  and table_name in ('app_settings', 'telegram_link_codes', 'photo_zip_links')), 0::bigint, 'AC11 global tables have no workspace');

-- Workspace W2 (made as the admin: the SQL Editor / service role).
insert into workspaces (id, name, created_at) values (t.x('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.x('XT'), 'xt@x.test', '{"full_name":"Xena Teacher"}'),
  (t.x('XM'), 'xm@x.test', '{"full_name":"Xavier Mentor"}'),
  (t.x('XS'), 'xs@x.test', '{"full_name":"Xia Student"}'),
  (t.x('XP'), 'xp@x.test', '{"full_name":"Xo Pending"}');
-- AC 4: a sign-up joins the oldest workspace as a waiting student; the admin moves these four to W2.
select t.ok((select bool_and(workspace_id = signup_workspace() and role = 'student' and access_status = 'pending')
  from profiles where id in (t.x('XT'), t.x('XM'), t.x('XS'), t.x('XP'))), 'AC4 a sign-up lands in the oldest workspace, waiting');
update profiles set workspace_id = t.x('W2') where id in (t.x('XT'), t.x('XM'), t.x('XS'), t.x('XP'));
update profiles set access_status = 'approved' where id in (t.x('XT'), t.x('XM'), t.x('XS'));
-- AC 2: W2 gets its own teacher (the first workspace's teacher T stays).
select t.eq(pg_temp.err(format('update profiles set role = %L where id = %L', 'teacher', t.x('XT'))), 'no error',
  'AC2 the second workspace gets its own teacher');
update profiles set role = 'mentor' where id = t.x('XM');
select t.eq(pg_temp.err(format('update profiles set role = %L where id = %L', 'teacher', t.x('XM'))), '42501 | sham:teacher_exists',
  'AC2 a second teacher in W2 is refused');
select t.eq((select count(*) from profiles where role = 'teacher'), 2::bigint, 'AC2 one teacher in each workspace');

insert into disciplines (id, name, created_by) values (t.x('XD'), 'Xmath', t.x('XT'));
insert into courses (id, title, created_by, discipline_id) values (t.x('XC'), 'Xcourse', t.x('XM'), t.x('XD'));
insert into course_members (course_id, user_id, added_by) values (t.x('XC'), t.x('XS'), t.x('XM'));
insert into course_meetings (id, course_id, starts_at, status, created_by)
  values (t.x('XMT'), t.x('XC'), now() - interval '1 day', 'completed', t.x('XM'));
-- Assignments and homework are made without triggers, as t.make_assignments() does, so the workspace is set here.
set session_replication_role = replica;
insert into homework_assignments (id, meeting_id, course_id, title, created_by, workspace_id)
  values (t.x('XA'), t.x('XMT'), t.x('XC'), 'Xassignment', t.x('XM'), t.x('W2'));
insert into homework (id, student_id, course_id, assignment_id, title, photo_path, status, workspace_id)
  values (t.x('XH'), t.x('XS'), t.x('XC'), t.x('XA'), 'Xhomework', t.x('XS') || '/xh.jpg', 'submitted', t.x('W2'));
set session_replication_role = origin;
insert into storage.objects (bucket_id, name, owner) values ('homework', t.x('XS') || '/xh.jpg', t.x('XS'));
insert into course_messages (id, course_id, author_id, body) values (t.x('XCM'), t.x('XC'), t.x('XS'), 'X chat');
insert into general_messages (id, author_id, body) values (t.x('XGM'), t.x('XS'), 'X general');
insert into materials (id, teacher_id, title, body) values (t.x('XMAT'), t.x('XT'), 'X post', 'x');
insert into material_likes (material_id, user_id) values (t.x('XMAT'), t.x('XS'));
insert into telegram_links (user_id, chat_id) values (t.x('XS'), 9001), (t.x('XM'), 9002), (t.id('S1'), 9003), (t.id('T'), 9004);
-- A message in the first workspace's course A, for the recipients check.
insert into course_messages (id, course_id, author_id, body) values (t.x('ACM'), t.id('A'), t.id('S1'), 'A chat');
insert into general_messages (id, author_id, body) values (t.x('AGM'), t.id('S1'), 'A general');

select t.ok((select bool_and(workspace_id = t.x('W2')) from (
  select workspace_id from courses where id = t.x('XC') union all
  select workspace_id from course_members where course_id = t.x('XC') union all
  select workspace_id from course_meetings where id = t.x('XMT') union all
  select workspace_id from general_messages where id = t.x('XGM') union all
  select workspace_id from material_likes where material_id = t.x('XMAT')) w), 'data: new rows take their parent''s workspace');

-- AC 5: the first workspace's teacher, a mentor and a student read only their workspace.
select t.login('T');
select t.eq((select count(*) from profiles where workspace_id = t.x('W2')), 0::bigint, 'AC5 teacher: no W2 accounts');
select t.eq((select count(*) from profiles), 7::bigint, 'AC5 teacher: the 7 accounts of the first workspace');
select t.eq((select count(*) from courses where id = t.x('XC')), 0::bigint, 'AC5 teacher: a W2 course by id is not found');
select t.eq((select count(*) from disciplines where id = t.x('XD')), 0::bigint, 'AC5 teacher: no W2 discipline');
select t.eq((select count(*) from course_meetings where id = t.x('XMT')), 0::bigint, 'AC5 teacher: no W2 meeting');
select t.eq((select count(*) from homework where id = t.x('XH')), 0::bigint, 'AC5 teacher: no W2 homework');
select t.eq((select count(*) from course_messages where id = t.x('XCM')), 0::bigint, 'AC5 teacher: no W2 course chat');
select t.eq((select count(*) from general_messages where id = t.x('XGM')), 0::bigint, 'AC5 teacher: no W2 general chat');
select t.eq((select count(*) from materials where id = t.x('XMAT')), 0::bigint, 'AC5 teacher: no W2 Blog post');
select t.eq((select count(*) from material_likes where material_id = t.x('XMAT')), 0::bigint, 'AC5 teacher: no W2 like');
select t.eq((select count(*) from workspaces), 1::bigint, 'AC5 teacher: reads only their own workspace');
select t.login('M');
select t.eq((select count(*) from courses where workspace_id = t.x('W2')), 0::bigint, 'AC5 mentor: no W2 course');
select t.eq((select count(*) from general_messages), 1::bigint, 'AC5 mentor: only the first workspace''s general chat');
select t.login('S1');
select t.eq((select count(*) from profiles where workspace_id = t.x('W2')), 0::bigint, 'AC5 student: no W2 accounts');
select t.xlogin('XS');
select t.eq((select count(*) from courses), 1::bigint, 'AC5 W2 student: only W2''s course');
select t.eq((select count(*) from general_messages), 1::bigint, 'AC5 W2 student: only W2''s general chat');

-- AC 6: functions and storage.
select t.login('T');
select t.eq((select count(*) from assignment_sent_counts(array[t.x('XC')])), 0::bigint, 'AC6 counts of a W2 course: nothing');
select t.eq(pg_temp.err(format('select * from course_homework_photos(%L)', t.x('XC'))), 'P0002 | sham:course_not_found',
  'AC6 delete-course photos of a W2 course: not found');
select t.eq(pg_temp.err(format('select * from discipline_payment_proofs(%L)', t.x('XD'))), 'P0002 | sham:discipline_not_found',
  'AC6 delete-discipline proofs of a W2 discipline: not found');
select t.eq(pg_temp.err(format('select * from listener_homework_photos(%L, %L)', t.x('XC'), t.x('XS'))), 'P0002 | sham:course_not_found',
  'AC6 a W2 listener''s photos: not found');
select t.ok(not exists (select 1 from access_requests() where id = t.x('XP')), 'AC6/9 the teacher doesn''t see W2''s requests');
select t.eq((select count(*) from storage.objects where name = t.x('XS') || '/xh.jpg'), 0::bigint, 'AC6 a W2 homework photo can''t be read');
select t.ok(pg_temp.err(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'homework',
  t.x('XS') || '/sneak.jpg', t.id('T'))) like '42501%', 'AC6 nothing can be uploaded into a W2 account''s folder');
select t.ok(not has_function_privilege('authenticated', 'homework_photos_for_zip(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'account_storage_objects(uuid)', 'execute'),
  'AC6 the service-role helpers can''t be called by app users');

-- AC 7: writes that link the two workspaces are refused.
select t.eq(pg_temp.err(format('insert into course_members (course_id, user_id, added_by) values (%L, %L, %L)', t.id('A'), t.x('XS'), t.id('T'))),
  '42501 | sham:workspace_mismatch', 'AC7 a W2 account as listener of a course');
select t.ok(pg_temp.err(format('select change_course_owner(%L, %L)', t.id('A'), t.x('XM'))) <> 'no error', 'AC7 a W2 account as owner of a course');
select t.ok(pg_temp.err(format('select set_course_discipline(%L, %L)', t.id('A'), t.x('XD'))) <> 'no error', 'AC7 a W2 discipline on a course');
select t.ok(pg_temp.err(format('insert into material_likes (material_id, user_id) values (%L, %L)', t.x('XMAT'), t.id('T'))) <> 'no error',
  'AC7 liking a W2 Blog post');
select t.ok(pg_temp.err(format('insert into course_messages (course_id, author_id, body) values (%L, %L, %L)', t.x('XC'), t.id('T'), 'hi')) <> 'no error',
  'AC7 posting in a W2 course chat');
select t.eq(t.affected(format('update homework set status = %L, checked_by = %L where id = %L', 'checked', t.id('T'), t.x('XH'))), 0::bigint,
  'AC7 marking W2 homework changes nothing');
select t.ok(pg_temp.err(format('select set_access_status(%L, %L)', t.x('XP'), 'approved')) <> 'no error', 'AC7/9 accepting a W2 account');
select t.ok(pg_temp.err(format('select set_accountant(%L, true)', t.x('XM'))) <> 'no error', 'AC7 Accountant on for a W2 mentor');
select t.ok(pg_temp.err(format('select set_user_role(%L, %L)', t.x('XS'), 'mentor')) <> 'no error', 'AC8 changing a W2 account''s role');
select t.ok(pg_temp.err(format('select delete_course(%L)', t.x('XC'))) <> 'no error', 'AC8 deleting a W2 course');
-- (Refused by the column grants already; the guard would refuse it too.)
select t.ok(pg_temp.err(format('insert into general_messages (author_id, body, workspace_id) values (%L, %L, %L)', t.id('T'), 'x', t.x('W2')))
  like '42501%', 'AC7 a row sent with another workspace''s id');
select t.eq(pg_temp.err(format('insert into course_members (course_id, user_id, added_by, workspace_id) values (%L, %L, %L, %L)',
  t.id('A'), t.id('S2'), t.id('T'), t.x('W2'))), '42501 | sham:workspace_mismatch', 'AC7 a listener row sent with W2''s id');
reset role;
select t.ok((select status = 'submitted' and checked_by is null from homework where id = t.x('XH'))
  and (select created_by = t.id('M') and discipline_id is null from courses where id = t.id('A'))
  and (select access_status = 'pending' from profiles where id = t.x('XP'))
  and not (select is_accountant from profiles where id = t.x('XM'))
  and exists (select 1 from courses where id = t.x('XC')), 'AC7 nothing in W2 changed');

-- AC 3: nobody changes an account's workspace from the app; the admin can.
select t.xlogin('XS');
select t.ok(pg_temp.err(format('update profiles set workspace_id = %L where id = %L', t.ws1(), t.x('XS'))) like '42501%',
  'AC3 an account can''t move itself (column grants)');
-- Even inside a security definer function called from the app, the guard refuses it.
select t.eq(pg_temp.err(format('select t.move_profile(%L, %L)', t.x('XS'), t.ws1())), '42501 | sham:workspace_locked',
  'AC3 not even through a function');
reset role;
select t.eq(pg_temp.err(format('select t.move_profile(%L, %L)', t.x('XP'), t.ws1())), 'no error', 'AC3 the admin can move an account');
update profiles set workspace_id = t.x('W2') where id = t.x('XP');

-- AC 8 / 9: W2's teacher has the teacher's rights in W2 only.
select t.xlogin('XT');
select t.eq((select array_agg(id) from access_requests()), array[t.x('XP')], 'AC9 W2''s teacher sees W2''s request');
select t.eq(pg_temp.err(format('select set_access_status(%L, %L)', t.x('XP'), 'approved')), 'no error', 'AC9 W2''s teacher accepts it');
select t.ok(not exists (select 1 from access_requests() where id = t.id('S1')), 'AC9 and sees no first-workspace accounts');
select t.ok(pg_temp.err(format('select set_access_status(%L, %L)', t.id('S2'), 'declined')) <> 'no error', 'AC8 W2''s teacher can''t decline a first-workspace account');
select t.eq((select count(*) from courses), 1::bigint, 'AC8 W2''s teacher reads W2''s course, hidden ones included');
reset role;
select t.eq((select access_status::text from profiles where id = t.id('S2')), 'approved', 'AC8 the first-workspace account is unchanged');

-- AC 10: notification recipients stay in the event's workspace.
select t.ok((select not (t.x('XT') = any(recipient_ids)) and t.id('T') = any(recipient_ids) from chat_message_recipients(t.x('ACM'))),
  'AC10 course chat: the course''s own teacher, not W2''s');
select t.ok((select bool_and(p.workspace_id = t.x('W2')) from general_message_recipients(t.x('XGM')) r, unnest(r.recipient_ids) u
  join profiles p on p.id = u), 'AC10 general chat: only W2 accounts');
select t.ok((select not (t.x('XS') = any(recipient_ids)) from general_message_recipients(t.x('AGM'))), 'AC10 general chat: no W2 account for the first workspace');
select t.ok((select array_agg(user_id order by user_id) from new_material_recipients('blog', t.x('XMAT')))
  = (select array_agg(id order by id) from profiles where id in (t.x('XS'), t.x('XM'))), 'AC10 new material: only W2 accounts with Telegram');
reset role;
insert into auth.users (id, email, raw_user_meta_data) values (t.x('XP2'), 'xp2@x.test', '{"full_name":"Xu New"}');
update profiles set workspace_id = t.x('W2') where id = t.x('XP2');
select t.eq((select array_agg(user_id) from new_account_notification(t.x('XP2'))), array[t.x('XT')],
  'AC10 new account: only the teacher of the workspace it joined');
