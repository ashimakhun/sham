-- QA ARU-145: gaps in aru145_workspaces.test.sql. Two workspaces with data in every workspace-scoped table; the first
-- workspace's teacher, accountant mentor, mentor and student (and a waiting account) try, table by table and function by
-- function, to read, link or change workspace W2, and the reverse for W2's teacher. Also: a material file moved to
-- another workspace's course (AC 7), Storage in every bucket (AC 6), the recipient functions not changed by 0059
-- (AC 10), manage-roles.sql per workspace (AC 2), and the global tables (AC 11).
-- Fixture (t.seed): teacher T, mentors M (owns A), N (owns B), M2 (Accountant, no course), students S1 (listener of
-- A), S2, S3. W2: teacher XT, mentor XM (owns XC in discipline XD), student XS (listener of XC), waiting XP.
select t.seed();
select t.make_assignments(t.id('A'));
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
update profiles set is_accountant = true where id = t.id('M2');

create function t.x(n text) returns uuid language sql immutable as $$ select md5('aru145qa' || n)::uuid $$;
grant execute on function t.x(text) to anon, authenticated;
create function t.xlogin(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.x(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.xlogin(text) to anon, authenticated;
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
-- How many rows of W2 a signed-in user sees in a table (by the row's workspace column, so "by id" for every row).
create function t.w2_rows(tbl text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where workspace_id = %L', tbl, t.x('W2')) into n;
  return n;
end $$;
grant execute on function t.w2_rows(text) to authenticated;

-- W2, made as the admin. Its people sign up (they land in the oldest workspace, AC 4) and are moved.
insert into workspaces (id, name, created_at) values (t.x('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.x('XT'), 'qxt@x.test', '{"full_name":"Xena Teacher"}'),
  (t.x('XM'), 'qxm@x.test', '{"full_name":"Xavier Mentor"}'),
  (t.x('XS'), 'qxs@x.test', '{"full_name":"Xia Student"}'),
  (t.x('XP'), 'qxp@x.test', '{"full_name":"Xo Pending"}');
update profiles set workspace_id = t.x('W2') where id in (t.x('XT'), t.x('XM'), t.x('XS'), t.x('XP'));
update profiles set access_status = 'approved' where id in (t.x('XT'), t.x('XM'), t.x('XS'));
update profiles set role = 'teacher' where id = t.x('XT');
update profiles set role = 'mentor', is_accountant = true where id = t.x('XM');
-- A waiting account in the first workspace too.
insert into auth.users (id, email, raw_user_meta_data) values (t.x('P1'), 'qp1@x.test', '{"full_name":"Pat Pending"}');

-- W2's data in every workspace-scoped table (as the admin, triggers on: the guard sets each row's workspace).
insert into disciplines (id, name, created_by) values (t.x('XD'), 'Xmath', t.x('XT'));
insert into courses (id, title, created_by, discipline_id) values (t.x('XC'), 'Xcourse', t.x('XM'), t.x('XD'));
insert into course_members (course_id, user_id, added_by) values (t.x('XC'), t.x('XS'), t.x('XM'));
insert into course_meetings (id, course_id, starts_at, status, created_by)
  values (t.x('XMT'), t.x('XC'), now() - interval '1 day', 'completed', t.x('XM')),
         (t.x('XMS'), t.x('XC'), now() + interval '1 day', 'scheduled', t.x('XM'));
set session_replication_role = replica;
insert into homework_assignments (id, meeting_id, course_id, title, created_by, workspace_id)
  values (t.x('XA'), t.x('XMT'), t.x('XC'), 'Xassignment', t.x('XM'), t.x('W2'));
insert into homework (id, student_id, course_id, assignment_id, title, photo_path, status, workspace_id)
  values (t.x('XH'), t.x('XS'), t.x('XC'), t.x('XA'), 'Xhomework', t.x('XS') || '/xh.jpg', 'submitted', t.x('W2'));
set session_replication_role = origin;
insert into meeting_attendance (meeting_id, user_id) values (t.x('XMT'), t.x('XS'));
insert into meeting_listener_notes (id, meeting_id, course_id, author_id, body, is_public)
  values (t.x('XN'), t.x('XMT'), t.x('XC'), t.x('XS'), 'X note', true);
insert into course_messages (id, course_id, author_id, body) values (t.x('XCM'), t.x('XC'), t.x('XS'), 'X chat');
insert into course_chat_reads (course_id, user_id, last_read_at) values (t.x('XC'), t.x('XS'), now());
insert into course_feedback (course_id, user_id, rating, body) values (t.x('XC'), t.x('XS'), 5, 'X feedback');
insert into course_billing (course_id, start_day, end_day, selected_by) values (t.x('XC'), 1, 10, t.x('XM'));
insert into course_payments (course_id, user_id, month, marked_by) values (t.x('XC'), t.x('XS'), date_trunc('month', now())::date, t.x('XM'));
insert into course_payment_exemptions (course_id, user_id, set_by) values (t.x('XC'), t.x('XS'), t.x('XM'));
insert into course_payment_requests (course_id, user_id, month, proof_path, proof_type)
  values (t.x('XC'), t.x('XS'), (date_trunc('month', now()) + interval '1 month')::date, t.x('XS') || '/proof.jpg', 'image');
insert into general_messages (id, author_id, body) values (t.x('XGM'), t.x('XS'), 'X general');
insert into general_chat_reads (user_id, last_read_at) values (t.x('XS'), now());
insert into materials (id, teacher_id, title, body) values (t.x('XMAT'), t.x('XT'), 'X post', 'x');
insert into material_likes (material_id, user_id) values (t.x('XMAT'), t.x('XS'));
insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.x('XF'), t.x('XT'), 'X pdf', t.x('XT') || '/' || t.x('XF') || '.pdf', 100);
insert into telegram_links (user_id, chat_id) values (t.x('XS'), 7001), (t.x('XT'), 7002), (t.id('S1'), 7003), (t.id('T'), 7004), (t.id('M'), 7005);
insert into photo_deletion_warnings (homework_id, mark, user_id, deletion_date) values (t.x('XH'), 30, t.x('XS'), current_date + 20);
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.x('XS') || '/xh.jpg', t.x('XS')),
  ('materials', t.x('XT') || '/' || t.x('XF') || '.pdf', t.x('XT')),
  ('payment-proofs', t.x('XS') || '/proof.jpg', t.x('XS'));
-- The first workspace's own material file (for the move test) and its files.
insert into material_files (id, author_id, name, storage_path, size_bytes, course_id, course_only)
  values (t.x('AF'), t.id('M'), 'A pdf', t.id('M') || '/' || t.x('AF') || '.pdf', 100, t.id('A'), true);

-- Every W2 row was set to W2 by the guard (no row defaults to the oldest workspace).
select t.eq((select count(*) from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'workspace_id'), 23::bigint,
  'data: 23 workspace-scoped tables (22 + profiles)');
do $$
declare r record; n bigint; missing text := '';
begin
  for r in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id' loop
    execute format('select count(*) from public.%I where workspace_id = %L', r.table_name, t.x('W2')) into n;
    if n = 0 then missing := missing || r.table_name || ' '; end if;
  end loop;
  perform t.eq(missing, '', 'data: W2 has rows in every workspace-scoped table (each set from its parent)');
end $$;

-- AC 5: every table, as each role of the first workspace: no W2 row, whatever the policies give that role.
do $$
declare who text; r record; n bigint; leaks text;
begin
  foreach who in array array['T', 'M', 'M2', 'S1'] loop
    perform t.login(who);
    leaks := '';
    for r in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id' loop
      n := t.w2_rows(r.table_name);
      if n > 0 then leaks := leaks || r.table_name || '=' || n || ' '; end if;
    end loop;
    reset role;
    perform t.eq(leaks, '', format('AC5 %s reads no W2 row in any of the 23 tables', who));
  end loop;
end $$;
select t.login('T');
select t.eq((select count(*) from workspaces where id = t.x('W2')), 0::bigint, 'AC5 teacher: W2 itself is not readable');
select t.eq((select count(*) from storage.objects where bucket_id = 'materials' and name like t.x('XT') || '/%'), 0::bigint,
  'AC6 teacher: a W2 Knowledge base PDF can''t be read');
select t.eq((select count(*) from storage.objects where bucket_id = 'payment-proofs'), 0::bigint, 'AC6 teacher: a W2 payment proof can''t be read');
select t.login('M2');
select t.eq((select count(*) from storage.objects where bucket_id = 'payment-proofs'), 0::bigint, 'AC6 Accountant: a W2 payment proof can''t be read');
select t.eq((select count(*) from my_payment_dues(current_date)), 0::bigint, 'AC6 Accountant: no W2 dues');
-- A waiting account of the first workspace still reads nothing but itself.
select t.xlogin('P1');
select t.eq((select count(*) from profiles), 1::bigint, 'AC5 a waiting account reads only its own profile');
select t.eq((select count(*) from courses) + (select count(*) from general_messages), 0::bigint, 'AC5 a waiting account reads no course or chat');
-- The reverse: W2's teacher and student read nothing of the first workspace.
select t.xlogin('XT');
select t.eq((select count(*) from profiles where workspace_id <> t.x('W2')), 0::bigint, 'AC5 W2 teacher: no first-workspace account');
select t.eq((select count(*) from homework) + (select count(*) from course_meetings where course_id = t.id('A'))
  + (select count(*) from material_files where id = t.x('AF')) + (select count(*) from telegram_links where user_id = t.id('T')),
  1::bigint, 'AC5 W2 teacher: only W2''s homework; no meeting, PDF or Telegram link of the first workspace');
select t.eq((select count(*) from storage.objects where name like t.id('S1') || '/%'), 0::bigint, 'AC6 W2 teacher: no first-workspace homework photo');
select t.ok(not exists (select 1 from access_requests() where id = t.x('P1')), 'AC9 W2 teacher: the first workspace''s waiting account is not listed');
reset role;

-- AC 6: functions with W2 ids, as the first workspace's teacher (who has every teacher right in their own workspace).
-- Each either refuses or does nothing (some return quietly for a course they can't see); the check after them proves
-- nothing in W2 changed.
select t.login('T');
select t.ok(pg_temp.err(format('select delete_discipline(%L)', t.x('XD'))) is not null, 'AC6 delete a W2 discipline: nothing or an error');
select t.ok(pg_temp.err(format('select remove_listener(%L, %L)', t.x('XC'), t.x('XS'))) is not null, 'AC6 remove a W2 listener: nothing or an error');
select t.ok(pg_temp.err(format('select set_meeting_status(%L, %L)', t.x('XMS'), 'canceled')) is not null, 'AC6 cancel a W2 meeting: nothing or an error');
select t.ok(pg_temp.err(format('select update_meeting(%L, now() + interval ''2 days'', null, %L)', t.x('XMS'), 'Room 1')) is not null, 'AC6 edit a W2 meeting: nothing or an error');
select t.ok(pg_temp.err(format('select set_meeting_homework_checked(%L, true)', t.x('XMT'))) is not null, 'AC6 mark a W2 meeting''s homework checked: nothing or an error');
select t.ok(pg_temp.err(format('select add_meeting_listener_notes(%L, %L, true)', t.x('XMT'), 'sneaky')) is not null, 'AC6 add notes to a W2 meeting: nothing or an error');
select t.ok(pg_temp.err(format('select delete_meeting_listener_notes(%L)', t.x('XN'))) is not null, 'AC6 delete a W2 note: nothing or an error');
select t.ok(pg_temp.err(format('select change_course_owner(%L, %L)', t.x('XC'), t.id('M'))) is not null, 'AC6 give a W2 course to a first-workspace mentor: nothing or an error');
select t.ok(pg_temp.err(format('select set_course_discipline(%L, null)', t.x('XC'))) is not null, 'AC6 take a W2 course out of its discipline: nothing or an error');
select t.ok(pg_temp.err(format('select set_accountant(%L, false)', t.x('XM'))) is not null, 'AC6 turn Accountant off for a W2 mentor: nothing or an error');
select t.ok(pg_temp.err(format('select set_access_status(%L, %L)', t.x('XP'), 'declined')) is not null, 'AC6 decline a W2 waiting account: nothing or an error');
select t.eq((select count(*) from listener_homework_photos(t.id('A'), t.x('XS'))), 0::bigint, 'AC6 photos of a W2 account in my course: none');
select t.login('S1');
select t.ok(pg_temp.err(format('select mark_attendance(%L)', t.x('XMT'))) is not null, 'AC6 a student marks attendance at a W2 meeting: nothing or an error');
select t.ok(pg_temp.err(format('select update_meeting_listener_notes(%L, %L, false)', t.x('XN'), 'mine now')) is not null, 'AC6 a student edits a W2 note: nothing or an error');
reset role;
select t.ok((select count(*) from disciplines where id = t.x('XD')) = 1
  and (select count(*) from course_members where course_id = t.x('XC')) = 1
  and (select status::text from course_meetings where id = t.x('XMS')) = 'scheduled'
  and (select location is null and homework_checked_at is null from course_meetings where id = t.x('XMS'))
  and (select homework_checked_at is null from course_meetings where id = t.x('XMT'))
  and (select count(*) from meeting_listener_notes where meeting_id = t.x('XMT')) = 1
  and (select body from meeting_listener_notes where id = t.x('XN')) = 'X note'
  and (select created_by = t.x('XM') and discipline_id = t.x('XD') from courses where id = t.x('XC'))
  and (select is_accountant from profiles where id = t.x('XM'))
  and (select access_status::text from profiles where id = t.x('XP')) = 'pending'
  and (select count(*) from meeting_attendance where meeting_id = t.x('XMT')) = 1,
  'AC6 nothing in W2 changed');

-- AC 7: direct writes that would link the two workspaces, each refused.
select t.login('T');
select t.ok(pg_temp.err(format('insert into courses (title, created_by, discipline_id) values (%L, %L, %L)', 'Mixed', t.id('T'), t.x('XD'))) <> 'no error',
  'AC7 a new course in a W2 discipline');
select t.ok(pg_temp.err(format('update profiles set full_name = %L where id = %L', 'Renamed', t.x('XS'))) <> 'no error'
  or (select full_name from profiles where id = t.x('XS')) is null, 'AC7 renaming a W2 account changes nothing');
select t.login('M2');
select t.ok(pg_temp.err(format('insert into course_billing (course_id, start_day, end_day) values (%L, 1, 5)', t.x('XC'))) <> 'no error',
  'AC7 an Accountant makes a W2 course paid');
select t.ok(pg_temp.err(format('insert into course_payments (course_id, user_id, month) values (%L, %L, %L)', t.x('XC'), t.x('XS'), '2026-01-01')) <> 'no error',
  'AC7 an Accountant marks a W2 payment');
select t.eq(t.affected(format('delete from course_payment_exemptions where course_id = %L', t.x('XC'))), 0::bigint,
  'AC7 an Accountant clears no W2 exemption');
select t.login('S1');
select t.ok(pg_temp.err(format('insert into course_feedback (course_id, user_id, rating, body) values (%L, %L, 1, %L)', t.x('XC'), t.id('S1'), 'bad')) <> 'no error',
  'AC7 feedback on a W2 course');
select t.ok(pg_temp.err(format('insert into course_chat_reads (course_id, user_id, last_read_at) values (%L, %L, now())', t.x('XC'), t.id('S1'))) <> 'no error',
  'AC7 a read position in a W2 course chat');
select t.ok(pg_temp.err(format('insert into course_payment_requests (course_id, user_id, month, proof_path, proof_type) values (%L, %L, %L, %L, %L)',
  t.x('XC'), t.id('S1'), '2026-01-01', t.id('S1') || '/p.jpg', 'image')) <> 'no error', 'AC7 a payment request for a W2 course');
select t.ok(pg_temp.err(format('insert into homework (student_id, course_id, assignment_id, title, status) values (%L, %L, %L, %L, %L)',
  t.id('S1'), t.id('A'), t.x('XA'), 'mixed', 'submitted')) <> 'no error', 'AC7 homework in my course for a W2 assignment');
select t.ok(pg_temp.err(format('insert into general_chat_reads (user_id, last_read_at, workspace_id) values (%L, now(), %L)', t.id('S1'), t.x('W2'))) <> 'no error',
  'AC7 a general chat read position sent with W2''s id');
select t.ok(pg_temp.err(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'materials',
  t.x('XT') || '/sneak.pdf', t.id('S1'))) like '42501%', 'AC6 nothing can be uploaded into a W2 Knowledge base folder');
select t.ok(pg_temp.err(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'payment-proofs',
  t.x('XS') || '/sneak.jpg', t.id('S1'))) like '42501%', 'AC6 nothing can be uploaded into a W2 payment-proof folder');
select t.eq(t.affected(format('delete from storage.objects where bucket_id = %L and name = %L', 'homework', t.x('XS') || '/xh.jpg')), 0::bigint,
  'AC6 a W2 homework photo can''t be deleted');
-- A first-workspace author links their own Knowledge base PDF to a W2 course (UPDATE of course_id, which app users may
-- change on their own files). This is a link between the two workspaces, so AC 7 says the database refuses it.
select t.login('M');
select t.eq(pg_temp.err(format('update material_files set course_id = %L where id = %L returning 1', t.x('XC'), t.x('AF'))),
  '42501 | sham:workspace_mismatch', 'AC7 a first-workspace PDF can''t be moved to a W2 course');
reset role;
select t.eq((select course_id from material_files where id = t.x('AF')), t.id('A'), 'AC7 the PDF still belongs to course A');
select t.ok((select count(*) from course_payment_exemptions where course_id = t.x('XC')) = 1
  and (select count(*) from course_billing where course_id = t.x('XC')) = 1
  and (select count(*) from course_payments where course_id = t.x('XC')) = 1
  and (select count(*) from course_feedback where course_id = t.x('XC')) = 1
  and (select count(*) from course_chat_reads where course_id = t.x('XC')) = 1
  and (select count(*) from course_payment_requests where course_id = t.x('XC')) = 1
  and (select full_name from profiles where id = t.x('XS')) = 'Xia Student'
  and (select count(*) from storage.objects where name = t.x('XS') || '/xh.jpg') = 1,
  'AC7 nothing in W2 changed');

-- AC 10: the recipient functions 0059 didn't change stay in the course's workspace (course rows can't mix them).
select t.eq((select array_agg(u order by u) from chat_message_recipients(t.x('XCM')) r, unnest(r.recipient_ids) u),
  (select array_agg(id order by id) from profiles where id in (t.x('XT'), t.x('XM'))), 'AC10 W2 course chat: W2''s teacher and owner, not the first teacher');
select t.eq((select array_agg(user_id) from new_homework_recipients(t.x('XA'))), array[t.x('XS')], 'AC10 new homework in W2: only W2''s listener');
select t.eq((select array_agg(user_id) from homework_submitted_recipient(t.x('XH'))), array[t.x('XM')],
  'AC10 homework sent in W2: only W2''s course owner');
insert into auth.users (id, email, raw_user_meta_data) values (t.x('P2'), 'qp2@x.test', '{"full_name":"Pia New"}');
select t.eq((select array_agg(user_id) from new_account_notification(t.x('P2'))), array[t.id('T')],
  'AC10 a new account in the first workspace: only its teacher, not W2''s');
update course_meetings set starts_at = now() - interval '30 seconds', start_notified_at = null where id = t.x('XMS');
select t.eq((select array_agg(u) from claim_started_meetings() c, unnest(c.listener_ids) u), array[t.x('XS')],
  'AC10 a W2 meeting starts: only W2''s listener');

-- AC 2: manage-roles.sql's "first teacher" query works per workspace: refused while the workspace has a teacher,
-- applied when it has none.
insert into workspaces (id, name, created_at) values (t.x('W3'), 'Third', now() + interval '1 second');
insert into auth.users (id, email, raw_user_meta_data) values (t.x('ZT'), 'qzt@x.test', '{"full_name":"Zed"}');
update profiles set workspace_id = t.x('W3') where id = t.x('ZT');
create function pg_temp.first_teacher(email text, ws uuid) returns bigint language plpgsql as $$
declare n bigint;
begin
  update profiles set role = 'teacher'
  where id = (select id from auth.users where auth.users.email = first_teacher.email)
    and workspace_id = ws
    and not exists (select 1 from profiles t where t.workspace_id = ws and t.role = 'teacher');
  get diagnostics n = row_count;
  return n;
end $$;
select t.eq(pg_temp.first_teacher('qxm@x.test', t.x('W2')), 0::bigint, 'AC2 manage-roles: W2 already has a teacher, nothing changes');
select t.eq(pg_temp.first_teacher('s2@x.test', t.x('W3')), 0::bigint, 'AC2 manage-roles: an account of another workspace isn''t made W3''s teacher');
select t.eq(pg_temp.first_teacher('qzt@x.test', t.x('W3')), 1::bigint, 'AC2 manage-roles: W3''s first teacher is made');
select t.eq((select string_agg(access_status::text || '/' || role::text, ',') from profiles where id = t.x('ZT')), 'approved/teacher',
  'AC2 the new teacher is approved (ARU-43)');
select t.eq((select count(*) from profiles where role = 'teacher'), 3::bigint, 'AC2 one teacher in each of the three workspaces');
select t.eq((select id from workspaces order by created_at, id limit 1), signup_workspace(), 'AC4 sign-ups still go to the oldest workspace');

-- AC 11: the global tables have no workspace and keep working for both workspaces.
select t.ok((select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id'
  and table_name in ('app_settings', 'telegram_link_codes', 'photo_zip_links', 'workspaces')) = 0, 'AC11 no workspace column on the global tables');
select t.xlogin('XS');
select t.ok(pg_temp.err('select create_telegram_link_code()') = 'no error', 'AC11 a W2 account still gets a Telegram link code');
select t.login('S1');
select t.ok(pg_temp.err('select create_telegram_link_code()') = 'no error', 'AC11 a first-workspace account too');
reset role;
