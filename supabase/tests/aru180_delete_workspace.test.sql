-- ARU-180: Delete workspace, part 1. Rules under test: supabase/migrations/0077_deactivated_status.sql and
-- 0078_delete_workspace.sql.
-- W1 is the fixture's workspace (t.seed(): teacher T, mentors M, N, M2, students S1-S3, courses A and B), plus a waiting
-- account P and a declined account D. W2 has teacher XT, mentor XM and student XS. Both get a row in every
-- workspace table, people rows (reset codes, blocks, ZIP links, push devices, settings, usernames, recovery codes,
-- agreements) and files in the three buckets. W1 is deleted; W2 must stay exactly as it was.
select t.seed();
-- The Edge Function calls as the service role.
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

create function t.x(n text) returns uuid language sql immutable as $$ select md5('aru180' || n)::uuid $$;
grant execute on function t.x(text) to anon, authenticated, service_role;
create function t.xlogin(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.x(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.xlogin(text) to anon, authenticated;

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

-- One row in every workspace table (and the people tables), without triggers, for workspace ws. tag keeps ids apart.
create function pg_temp.fill(tag text, ws uuid, teacher uuid, mentor uuid, student uuid) returns void language plpgsql as $$
declare
  d uuid := t.x(tag || 'D');
  c uuid := t.x(tag || 'C');
  mt uuid := t.x(tag || 'MT');
  a uuid := t.x(tag || 'A');
  h uuid := t.x(tag || 'H');
  b uuid := t.x(tag || 'B');
  f uuid := t.x(tag || 'F');
begin
  set local session_replication_role = replica;
  insert into disciplines (id, name, created_by, workspace_id) values (d, tag || ' discipline', teacher, ws);
  insert into courses (id, title, created_by, discipline_id, workspace_id) values (c, tag || ' course', mentor, d, ws);
  insert into course_members (course_id, user_id, added_by, workspace_id) values (c, student, mentor, ws);
  insert into course_messages (course_id, author_id, body, workspace_id) values (c, student, 'hi', ws);
  insert into course_chat_reads (course_id, user_id, last_read_at, workspace_id) values (c, student, now(), ws);
  insert into course_meetings (id, course_id, starts_at, status, created_by, workspace_id)
    values (mt, c, now() - interval '1 day', 'completed', mentor, ws);
  insert into meeting_attendance (meeting_id, user_id, workspace_id) values (mt, student, ws);
  insert into meeting_listener_notes (meeting_id, course_id, author_id, body, is_public, workspace_id)
    values (mt, c, student, 'notes', true, ws);
  insert into homework_assignments (id, meeting_id, course_id, title, created_by, workspace_id)
    values (a, mt, c, 'task', mentor, ws);
  insert into homework (id, student_id, course_id, assignment_id, title, photo_path, status, workspace_id)
    values (h, student, c, a, 'hw', student || '/' || tag || '.jpg', 'submitted', ws);
  insert into photo_deletion_warnings (homework_id, mark, user_id, deletion_date, workspace_id)
    values (h, 7, student, current_date + 7, ws);
  insert into course_feedback (course_id, user_id, rating, body, workspace_id) values (c, student, 5, 'good', ws);
  insert into course_billing (course_id, start_day, end_day, selected_by, workspace_id) values (c, 1, 10, teacher, ws);
  insert into course_payments (course_id, user_id, month, marked_by, workspace_id)
    values (c, student, date_trunc('month', now())::date, teacher, ws);
  insert into course_payment_exemptions (course_id, user_id, set_by, workspace_id) values (c, student, teacher, ws);
  insert into course_payment_requests (course_id, user_id, month, proof_path, proof_type, workspace_id)
    values (c, student, date_trunc('month', now())::date, student || '/' || tag || '-proof.jpg', 'image', ws);
  insert into materials (id, teacher_id, title, body, workspace_id) values (b, teacher, 'post', 'body', ws);
  insert into material_likes (material_id, user_id, workspace_id) values (b, student, ws);
  insert into material_files (id, author_id, name, course_id, storage_path, size_bytes, workspace_id)
    values (f, mentor, 'file', c, mentor || '/' || f || '.pdf', 10, ws);
  insert into general_messages (author_id, body, workspace_id) values (student, 'general', ws);
  insert into general_chat_reads (user_id, last_read_at, workspace_id) values (student, now(), ws);
  insert into content_reports (workspace_id, reporter_id, content_kind, content_id, author_id, reason)
    values (ws, student, 'general_message', gen_random_uuid(), mentor, 'spam');
  insert into push_devices (user_id, device_id, token, platform, workspace_id) values
    (teacher, tag || 'dt', 'ExponentPushToken[' || tag || 't]', 'ios', ws),
    (student, tag || 'ds', 'ExponentPushToken[' || tag || 's]', 'ios', ws);
  insert into notification_settings (user_id, workspace_id) values (teacher, ws), (student, ws), (mentor, ws);
  insert into reset_codes (user_id, code_hash, expires_at, created_by) values (student, 'x', now() + interval '1 day', teacher);
  insert into photo_zip_links (token_hash, user_id, homework_ids, expires_at) values (tag || 'zip', teacher, array[h], now() + interval '1 hour');
  insert into user_blocks (blocker_id, blocked_id) values (student, mentor);
  insert into usernames (user_id, username) values (teacher, lower(tag) || 'teacher'), (student, lower(tag) || 'student')
    on conflict do nothing;
  insert into recovery_codes (user_id, code_hash) values (teacher, 'x'), (student, 'x');
  insert into legal_agreements (user_id, version) values (teacher, 1), (student, 1);
  set local session_replication_role = origin;
  insert into storage.objects (bucket_id, name, owner) values
    ('homework', student || '/' || tag || '.jpg', student),
    ('materials', mentor || '/' || f || '.pdf', mentor),
    ('payment-proofs', student || '/' || tag || '-proof.jpg', student);
end $$;

-- W1: the fixture, a waiting account P and a declined account D.
create temp table ws1 as select signup_workspace() as id;
insert into auth.users (id, email, raw_user_meta_data) values
  (t.x('P'), 'p@x.test', '{"full_name":"Pat Pending"}'),
  (t.x('D'), 'd@x.test', '{"full_name":"Dee Declined"}');
update profiles set access_status = 'rejected' where id = t.x('D');
update profiles set is_accountant = true where id = t.id('M');
select pg_temp.fill('W1', (select id from ws1), t.id('T'), t.id('M'), t.id('S1'));

-- W2 (made as the admin).
insert into workspaces (id, name, created_at) values (t.x('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.x('XT'), 'xt@x.test', '{"full_name":"Xena Teacher"}'),
  (t.x('XM'), 'xm@x.test', '{"full_name":"Xavier Mentor"}'),
  (t.x('XS'), 'xs@x.test', '{"full_name":"Xia Student"}');
update profiles set workspace_id = t.x('W2'), access_status = 'approved' where id in (t.x('XT'), t.x('XM'), t.x('XS'));
update profiles set role = 'teacher' where id = t.x('XT');
update profiles set role = 'mentor' where id = t.x('XM');
select pg_temp.fill('W2', t.x('W2'), t.x('XT'), t.x('XM'), t.x('XS'));

-- W2 before: rows per workspace table, its people's rows and files.
create temp table w2_before as
  select c.table_name::text as tbl, 0::bigint as n
  from information_schema.columns c
  join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
  where c.table_schema = 'public' and c.column_name = 'workspace_id' and tb.table_type = 'BASE TABLE';
do $$
declare r record; cnt bigint;
begin
  for r in select tbl from w2_before loop
    execute format('select count(*) from public.%I where workspace_id = %L', r.tbl, t.x('W2')) into cnt;
    update w2_before set n = cnt where tbl = r.tbl;
  end loop;
end $$;
create temp view w2_people_rows as
  select (select count(*) from reset_codes where user_id in (t.x('XT'), t.x('XM'), t.x('XS')))
       + (select count(*) from photo_zip_links where user_id in (t.x('XT'), t.x('XM'), t.x('XS')))
       + (select count(*) from user_blocks where blocker_id in (t.x('XT'), t.x('XM'), t.x('XS')))
       + (select count(*) from usernames where user_id in (t.x('XT'), t.x('XM'), t.x('XS')))
       + (select count(*) from recovery_codes where user_id in (t.x('XT'), t.x('XM'), t.x('XS')))
       + (select count(*) from legal_agreements where user_id in (t.x('XT'), t.x('XM'), t.x('XS')))
       + (select count(*) from workspace_invite_codes where workspace = t.x('W2')) as n;
create temp table w2_people_before as select n from w2_people_rows;
create temp table w2_files_before as
  select bucket_id, name from storage.objects
  where (storage.foldername(name))[1] in (t.x('XT')::text, t.x('XM')::text, t.x('XS')::text);
grant select on w2_before, w2_people_before, w2_files_before, ws1 to authenticated, service_role;

select t.ok((select n from w2_people_before) >= 10 and (select count(*) from w2_files_before) = 3
  and (select sum(n) from w2_before) >= 25, 'setup: W2 has rows, people rows and files');

-- Schema.
select t.ok('deactivated' = any (enum_range(null::access_status)::text[]), 'AC8 access_status has deactivated');
select t.ok(not has_function_privilege('authenticated', 'delete_workspace(uuid)', 'execute')
  and not has_function_privilege('anon', 'delete_workspace(uuid)', 'execute')
  and has_function_privilege('service_role', 'delete_workspace(uuid)', 'execute'),
  'access: delete_workspace() is for the service role only');
select t.ok(not has_function_privilege('authenticated', 'workspace_storage_objects(uuid)', 'execute')
  and not has_function_privilege('anon', 'workspace_storage_objects(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'workspace_deletion_target(uuid)', 'execute')
  and not has_function_privilege('anon', 'workspace_deletion_target(uuid)', 'execute'),
  'access: the Edge Function helpers are for the service role only');
select t.ok(not has_function_privilege('anon', 'workspace_deletion_summary()', 'execute'),
  'access: the summary is not for anon');
select t.eq(pg_temp.err(format('update profiles set workspace_id = null where id = %L', t.id('S2'))), '23514',
  'AC8 constraint: no workspace needs deactivated');
select t.eq(pg_temp.err(format('update profiles set access_status = %L where id = %L', 'deactivated', t.id('S2'))), '23514',
  'AC8 constraint: deactivated needs no workspace');

-- AC 2: the screen's name and count (every other account: approved, waiting and declined).
select t.login('T');
select t.eq((select name || ' ' || other_accounts from workspace_deletion_summary()), 'Sham 8',
  'AC2 the teacher sees the workspace name and 8 other accounts');
select t.login('M');
select t.eq((select count(*) from workspace_deletion_summary()), 0::bigint, 'AC2 a mentor gets no summary');
select t.login('S1');
select t.eq((select count(*) from workspace_deletion_summary()), 0::bigint, 'AC2 a student gets no summary');
reset role;

-- The Edge Function's view (service role).
set role service_role;
select t.eq((select workspace_name || ' ' || other_accounts from workspace_deletion_target(t.id('T'))), 'Sham 8',
  'target: the teacher''s workspace');
select t.eq((select count(*) from workspace_deletion_target(t.id('M'))), 0::bigint, 'target: none for a mentor');
select t.eq((select count(*) from workspace_deletion_target(t.id('S1'))), 0::bigint, 'target: none for a student');
select t.eq((select count(*) from workspace_storage_objects((select id from ws1))), 3::bigint + 2,
  'files: the workspace''s 3 files plus the fixture''s two homework photos');
select t.ok(not exists (select 1 from workspace_storage_objects((select id from ws1)) o
  where (storage.foldername(o.name))[1] in (t.x('XT')::text, t.x('XM')::text, t.x('XS')::text)),
  'files: none of W2''s');

-- Access: only the teacher, and only their own workspace.
select t.eq(pg_temp.err(format('select delete_workspace(%L)', t.id('M'))), '42501 | sham:workspace_delete_teacher_only',
  'access: a mentor can''t delete the workspace');
select t.eq(pg_temp.err(format('select delete_workspace(%L)', t.id('S1'))), '42501 | sham:workspace_delete_teacher_only',
  'access: a student can''t delete the workspace');
select t.eq(pg_temp.err(format('select delete_workspace(%L)', gen_random_uuid())), '42501 | sham:workspace_delete_teacher_only',
  'access: an unknown id deletes nothing');

-- AC 11: files still there → refused, nothing changes.
select t.eq(pg_temp.err(format('select delete_workspace(%L)', t.id('T'))), '55000 | sham:workspace_delete_files_left',
  'AC11 a file left: refused');
reset role;
select t.ok(exists (select 1 from profiles where id = t.id('T')) and exists (select 1 from workspaces w join ws1 on ws1.id = w.id)
  and (select count(*) from courses where workspace_id = (select id from ws1)) = 3,
  'AC11 nothing changed');

-- A plain account deletion (ARU-75) of the teacher is still refused, with the unchanged message.
select t.eq(pg_temp.err(format('delete from auth.users where id = %L', t.x('XT'))), 'P0001 | sham:delete_teacher',
  'ARU-75 a plain deletion still refuses the teacher');

-- AC 11: a failure in the middle of the transaction rolls everything back.
delete from storage.objects o using (select * from workspace_storage_objects((select id from ws1))) w
  where o.bucket_id = w.bucket_id and o.name = w.name;
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
create trigger boom before delete on workspaces for each row execute function pg_temp.boom();
set role service_role;
select t.ok(pg_temp.err(format('select delete_workspace(%L)', t.id('T'))) <> 'no error', 'AC11 a forced failure fails');
reset role;
drop trigger boom on workspaces;
select t.ok(exists (select 1 from auth.users where id = t.id('T'))
  and (select count(*) from courses where workspace_id = (select id from ws1)) = 3
  and (select access_status from profiles where id = t.id('S1')) = 'approved'
  and (select count(*) from push_devices where user_id = t.id('S1')) = 1,
  'AC11 rolled back: teacher, rows and members as before');

-- AC 11: a member's upload after the files step stops the transaction; a retry (after removing it) works.
insert into storage.objects (bucket_id, name, owner) values ('homework', t.id('S2') || '/late.jpg', t.id('S2'));
set role service_role;
select t.eq(pg_temp.err(format('select delete_workspace(%L)', t.id('T'))), '55000 | sham:workspace_delete_files_left',
  'AC11 a late upload by a member: refused');
reset role;
delete from storage.objects where name = t.id('S2') || '/late.jpg';

-- The deletion.
set role service_role;
select t.lives(format('select delete_workspace(%L)', t.id('T')), 'AC5 the deletion succeeds');
reset role;

-- AC 6: nothing of W1 is left.
do $$
declare r record; cnt bigint;
begin
  for r in select tbl from w2_before loop
    execute format('select count(*) from public.%I where workspace_id = %L', r.tbl, (select id from ws1)) into cnt;
    perform t.eq(cnt, 0::bigint, 'AC6 no row of the workspace in ' || r.tbl);
  end loop;
end $$;
select t.eq((select count(*) from workspaces w join ws1 on ws1.id = w.id), 0::bigint, 'AC6 the workspace is gone');
select t.eq((select count(*) from workspace_invite_codes c join ws1 on ws1.id = c.workspace), 0::bigint, 'AC6 its invite code is gone');
select t.eq((select count(*) from reset_codes where user_id = t.id('S1')), 0::bigint, 'AC6 reset codes gone');
select t.eq((select count(*) from photo_zip_links where token_hash = 'W1zip'), 0::bigint, 'AC6 photo ZIP links gone');
select t.eq((select count(*) from user_blocks where blocker_id = t.id('S1')), 0::bigint, 'AC6 blocks between its people gone');
select t.eq((select count(*) from push_devices where user_id in (t.id('S1'), t.id('T'))), 0::bigint, 'AC6/8 every push device gone, members'' too');
select t.eq((select count(*) from notification_settings where user_id in (t.id('S1'), t.id('M'), t.id('T'))), 0::bigint,
  'AC6/8 every notification setting gone, members'' too');
select t.eq((select count(*) from storage.objects where (storage.foldername(name))[1] in
  (select id::text from profiles where access_status = 'deactivated') or (storage.foldername(name))[1] = t.id('T')::text),
  0::bigint, 'AC6 no file of the workspace''s people');

-- AC 7: the teacher is gone, the username is free.
select t.eq((select count(*) from auth.users where id = t.id('T')), 0::bigint, 'AC7 the teacher''s Auth user is gone');
select t.eq((select count(*) from profiles where id = t.id('T')), 0::bigint, 'AC7 the teacher''s profile is gone');
select t.eq((select count(*) from usernames where username = 'w1teacher'), 0::bigint, 'AC7 the username is free');
select t.eq((select count(*) from recovery_codes where user_id = t.id('T'))
  + (select count(*) from legal_agreements where user_id = t.id('T')), 0::bigint, 'AC7 recovery code and agreements gone');

-- AC 8: the 8 others are deactivated, exactly so, and keep their login data.
select t.eq((select count(*) from profiles where access_status = 'deactivated'), 8::bigint, 'AC8 8 accounts deactivated');
select t.ok((select bool_and(workspace_id is null and mentor_id is null and not is_accountant and access_changed_by is null
    and access_changed_at > now() - interval '1 minute')
  from profiles where id in (t.id('M'), t.id('N'), t.id('M2'), t.id('S1'), t.id('S2'), t.id('S3'), t.x('P'), t.x('D'))),
  'AC8 no workspace, mentor or accountant; changed now by nobody');
select t.eq((select role::text from profiles where id = t.id('M')) || (select role::text from profiles where id = t.id('S1')),
  'mentorstudent', 'AC8 roles kept');
select t.eq((select count(*) from auth.users where id in (t.id('M'), t.id('S1'), t.x('P'), t.x('D'))), 4::bigint,
  'AC8 Auth users kept (waiting and declined too)');
select t.eq((select count(*) from usernames where user_id = t.id('S1'))
  + (select count(*) from recovery_codes where user_id = t.id('S1'))
  + (select count(*) from legal_agreements where user_id = t.id('S1')), 3::bigint,
  'AC8 username, recovery code and agreements kept');
select t.eq((select full_name from profiles where id = t.id('S1')), 'Student Sam', 'AC8 display name kept');

-- AC 6: W2 is exactly as before.
do $$
declare r record; cnt bigint;
begin
  for r in select tbl, n from w2_before loop
    execute format('select count(*) from public.%I where workspace_id = %L', r.tbl, t.x('W2')) into cnt;
    perform t.eq(cnt, r.n, 'AC6 W2 unchanged: ' || r.tbl);
  end loop;
end $$;
select t.eq((select n from w2_people_rows), (select n from w2_people_before), 'AC6 W2 people rows unchanged');
select t.eq((select count(*) from storage.objects o join w2_files_before b using (bucket_id, name)), 3::bigint,
  'AC6 W2 files unchanged');
select t.eq((select access_status::text from profiles where id = t.x('XS')), 'approved', 'AC6 W2 accounts untouched');

-- Roles and access: a deactivated account reads only its own profile.
select t.login('S1');
select t.eq((select count(*) from profiles), 1::bigint, 'access: deactivated reads exactly one profile');
select t.eq((select id from profiles), t.id('S1'), 'access: ... its own');
select t.eq((select access_status::text from profiles), 'deactivated', 'AC9 it sees its status');
do $$
declare r record; cnt bigint;
begin
  for r in select tbl from w2_before where tbl <> 'profiles' loop
    execute format('select count(*) from public.%I', r.tbl) into cnt;
    perform t.eq(cnt, 0::bigint, 'access: deactivated reads nothing from ' || r.tbl);
  end loop;
end $$;
select t.eq((select count(*) from workspaces), 0::bigint, 'access: deactivated reads no workspace');
select t.eq((select count(*) from storage.objects where bucket_id in ('homework', 'materials', 'payment-proofs')), 0::bigint,
  'access: deactivated reads no files');
select t.eq(my_workspace(), null::uuid, 'access: no workspace');
select t.eq(my_role(), null::user_role, 'access: no role');
select t.ok(not is_approved(), 'access: not approved');

-- Own updates: the granted columns only.
select t.eq(t.affected(format('update profiles set device_language = %L where id = %L', 'ru', t.id('S1'))), 1::bigint,
  'access: deactivated updates its device_language');
select t.eq(t.affected(format('update profiles set full_name = %L, language = %L where id = %L', 'Sam B', 'en', t.id('S1'))),
  1::bigint, 'access: deactivated updates its name and language');
select t.eq(pg_temp.err(format('update profiles set workspace_id = %L where id = %L', t.x('W2'), t.id('S1'))), '42501',
  'access: workspace_id stays locked');
select t.eq(pg_temp.err(format('update profiles set access_status = %L where id = %L', 'approved', t.id('S1'))), '42501',
  'access: access_status stays locked');
select t.eq(pg_temp.err(format('update profiles set role = %L where id = %L', 'teacher', t.id('S1'))), '42501',
  'access: role stays locked');
select t.eq(pg_temp.err(format('update profiles set mentor_id = %L where id = %L', t.id('M'), t.id('S1'))), '42501',
  'access: mentor_id stays locked');
select t.eq(pg_temp.err(format('update profiles set is_accountant = true where id = %L', t.id('M'))), '42501',
  'access: is_accountant stays locked');
select t.eq(t.affected(format('update profiles set full_name = %L where id = %L', 'Hacked', t.id('S2'))), 0::bigint,
  'access: another deactivated profile can''t be changed');

-- Writes: refused even though default_workspace() now returns the oldest workspace (W2).
select t.ok(default_workspace() = t.x('W2'), 'setup: default_workspace() is W2 for a deactivated account');
select t.ok(pg_temp.err(format('insert into course_messages (course_id, author_id, body) values (%L, %L, %L)',
  t.x('W2C'), t.id('S1'), 'sneak')) <> 'no error', 'access: insert into a W2 course chat refused');
select t.ok(pg_temp.err(format('insert into general_messages (author_id, body) values (%L, %L)', t.id('S1'), 'sneak')) <> 'no error',
  'access: insert into general chat refused');
select t.ok(pg_temp.err(format('insert into content_reports (reporter_id, content_kind, content_id, reason) values (%L, %L, %L, %L)',
  t.id('S1'), 'general_message', gen_random_uuid(), 'spam')) <> 'no error', 'access: insert into content_reports refused');
select t.ok(pg_temp.err(format('insert into push_devices (user_id, device_id, token, platform) values (%L, %L, %L, %L)',
  t.id('S1'), 'd', 'ExponentPushToken[z]', 'ios')) <> 'no error', 'access: insert into push_devices refused');
select t.eq(pg_temp.err($$select register_push_device('d', 'ExponentPushToken[z]', 'ios')$$), '42501 | sham:notifications_not_accepted',
  'AC9 push registration refused');
select t.ok(pg_temp.err($$select set_notification('chat_message', true)$$) like '42501%', 'access: settings refused');
select t.ok(pg_temp.err(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)',
  'homework', t.id('S1') || '/new.jpg', t.id('S1'))) <> 'no error', 'access: homework upload refused');
select t.ok(pg_temp.err(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)',
  'materials', t.id('S1') || '/new.pdf', t.id('S1'))) <> 'no error', 'access: materials upload refused');
select t.ok(pg_temp.err(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)',
  'payment-proofs', t.id('S1') || '/new.jpg', t.id('S1'))) <> 'no error', 'access: payment proof upload refused');
select t.ok(pg_temp.err(format('select * from make_reset_code(%L)', t.id('S2'))) like '42501%',
  'access: make_reset_code() on another deactivated account refused (note 2)');
select t.ok(pg_temp.err('select * from access_requests()') like '42501%', 'access: access_requests() refused');
select t.eq((select count(*) from workspace_usernames()), 0::bigint, 'access: workspace_usernames() empty');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'access: my_workspace_invite() empty');
select t.eq((select count(*) from workspace_deletion_summary()), 0::bigint, 'access: no deletion summary');
select t.ok(pg_temp.err(format('select report_content(%L, %L, %L)', 'general_message', gen_random_uuid(), 'spam')) like '42501%',
  'access: report_content() refused');
select t.ok(pg_temp.err(format('select resolve_report(%L, %L)', gen_random_uuid(), 'dismissed')) like '42501%',
  'access: resolve_report() refused');

-- A W2 user can't see the deactivated accounts either.
select t.xlogin('XT');
select t.eq((select count(*) from profiles where access_status = 'deactivated'), 0::bigint, 'access: W2 teacher sees no deactivated account');
select t.eq((select count(*) from profiles), 3::bigint, 'access: W2 teacher still sees exactly W2''s accounts');
select t.xlogin('XS');
select t.eq((select count(*) from profiles), 3::bigint, 'access: W2 student still sees exactly W2''s accounts');
reset role;

-- AC 9: a deactivated account deletes its own account (ARU-75), with no course-owner block.
set role service_role;
select t.eq(account_deletion_problem(t.id('M')), null::text, 'AC9 a former course owner may delete their account');
reset role;
select t.lives(format('delete from auth.users where id = %L', t.id('M')), 'AC9 the deactivated account is deleted');
select t.eq((select count(*) from profiles where id = t.id('M')), 0::bigint, 'AC9 its profile is gone');
