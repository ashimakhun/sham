-- ARU-43: new accounts wait for the teacher's approval. Rules under test: supabase/migrations/0021_account_approval.sql.
-- Fixture (t.seed): approved teacher T, mentors M (owns A), N (owns B), M2, students S1, S2, S3. S1 is a listener of A
-- with homework (a photo), attendance and a chat message; there are a blog post and a Knowledge base PDF.
-- New sign-ups P (stays pending) and R (rejected by the teacher).
select t.seed();

create function t.u(name text) returns uuid language sql immutable as $$
  select (case name when 'P' then '00000000-0000-0000-0000-0000000004a1' when 'R' then '00000000-0000-0000-0000-0000000004a2' end)::uuid
$$;
grant execute on function t.u(text) to anon, authenticated;
-- Log in as a new account (t.login only knows the fixture's names).
create function t.login_new(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t.u(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.login_new(text) to anon, authenticated;

-- Content for the denied checks.
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into course_messages (course_id, author_id, body) values (t.id('A'), t.id('M'), 'Hello');
set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, status, created_by, notes)
  values ('00000000-0000-0000-0000-0000000004b1', t.id('A'), now() - interval '1 day', 'completed', t.id('M'), 'Notes');
insert into meeting_attendance (meeting_id, user_id) values ('00000000-0000-0000-0000-0000000004b1', t.id('S1'));
set session_replication_role = origin;
select t.make_assignments(t.id('A'));
insert into materials (teacher_id, title, body) values (t.id('T'), 'Blog post', 'x');
insert into storage.objects (bucket_id, name, owner) values ('materials', t.id('M') || '/' || '00000000-0000-0000-0000-0000000004c1' || '.pdf', t.id('M'));
insert into material_files (id, author_id, name, storage_path, size_bytes)
  values ('00000000-0000-0000-0000-0000000004c1', t.id('M'), 'Book', t.id('M') || '/00000000-0000-0000-0000-0000000004c1.pdf', 10);

-- AC 9: everyone in the fixture is approved; a new sign-up is pending.
select t.eq((select count(*) from profiles where access_status <> 'approved'), 0::bigint, 'AC9 existing accounts are approved');
insert into auth.users (id, email, raw_user_meta_data) values
  (t.u('P'), 'p@x.test', '{"full_name":"Pending Pat"}'),
  (t.u('R'), 'r@x.test', '{"full_name":"Rejected Rae"}');
select t.eq((select access_status::text from profiles where id = t.u('P')), 'pending', 'AC1 a new account is pending');
select t.eq((select role::text from profiles where id = t.u('P')), 'student', 'AC1 as a student');

-- AC 5 / AC 7: only the teacher sees requests and decides.
select t.login('S1');
select t.throws($$select * from access_requests()$$, '42501', 'AC7 a student cannot list requests');
select t.throws($$select set_access_status(t.u('P'), 'approved')$$, '42501', 'AC7 a student cannot accept');
select t.ok(not exists (select 1 from profiles where id = t.u('P')), 'AC7 approved students don''t see pending accounts');
select t.login('M');
select t.throws($$select set_access_status(t.u('P'), 'approved')$$, '42501', 'AC7 a mentor cannot accept');
select t.throws($$select * from access_requests()$$, '42501', 'AC7 a mentor cannot list requests');
select t.login('T');
select t.eq((select string_agg(full_name || ' <' || email || '> ' || access_status, ', ') from access_requests()),
  'Pending Pat <p@x.test> pending, Rejected Rae <r@x.test> pending', 'AC5 the teacher lists requests oldest first with email');
select t.ok(exists (select 1 from profiles where id = t.u('P')), 'the teacher sees pending profiles');
select t.throws($$select set_access_status(t.id('T'), 'rejected')$$, '42501', 'AC7 the teacher''s own status cannot change');
select t.throws($$select set_access_status(t.u('P'), 'pending')$$, '22023', 'only accept or decline');
select t.throws($$select set_access_status(t.id('S2'), 'rejected')$$, '23514', 'an accepted account cannot be declined');
select t.lives($$select set_access_status(t.u('R'), 'rejected')$$, 'AC6 the teacher declines R');
select t.lives($$select set_access_status(t.u('R'), 'rejected')$$, 'AC6 declining again is a no-op (retry)');
select t.eq((select access_status::text || '/' || (access_changed_by = t.id('T'))::text from profiles where id = t.u('R')),
  'rejected/true', 'AC6 R is rejected, by the teacher');

-- AC 4: pending and rejected accounts read only their own profile and write nothing.
reset role;
create function t.denied(who text) returns void language plpgsql as $$
begin
  perform t.login_new(who);
  perform t.eq((select count(*) from profiles), 1::bigint, format('AC4 %s reads only their own profile', who));
  perform t.ok(exists (select 1 from profiles where id = t.u(who)), format('AC4 %s reads their own row (status)', who));
  perform t.eq((select count(*) from courses), 0::bigint, format('AC4 %s: no courses', who));
  perform t.eq((select count(*) from course_members), 0::bigint, format('AC4 %s: no listeners', who));
  perform t.eq((select count(*) from course_meetings), 0::bigint, format('AC4 %s: no meetings or notes', who));
  perform t.eq((select count(*) from homework_assignments), 0::bigint, format('AC4 %s: no assignments', who));
  perform t.eq((select count(*) from homework), 0::bigint, format('AC4 %s: no homework', who));
  perform t.eq((select count(*) from course_messages), 0::bigint, format('AC4 %s: no chat', who));
  perform t.eq((select count(*) from course_chat_reads), 0::bigint, format('AC4 %s: no read positions', who));
  perform t.eq((select count(*) from meeting_attendance), 0::bigint, format('AC4 %s: no attendance', who));
  perform t.eq((select count(*) from materials), 0::bigint, format('AC4 %s: no blog posts', who));
  perform t.eq((select count(*) from material_files), 0::bigint, format('AC4 %s: no Knowledge base items', who));
  perform t.eq((select count(*) from storage.objects), 0::bigint, format('AC4 %s: no files in either bucket', who));
  perform t.eq((select count(*) from chat_unread_counts()), 0::bigint, format('AC4 %s: no unread counts', who));
  perform t.throws(format($q$insert into storage.objects (bucket_id, name, owner) values ('homework', '%s/x.jpg', '%s')$q$, t.u(who), t.u(who)),
    '42501', format('AC4 %s cannot upload a homework photo to their own folder', who));
  perform t.throws(format($q$insert into storage.objects (bucket_id, name, owner) values ('materials', '%s/x.pdf', '%s')$q$, t.u(who), t.u(who)),
    '42501', format('AC4 %s cannot upload a PDF', who));
  perform t.throws(format($q$insert into course_messages (course_id, author_id, body) values ('%s', '%s', 'hi')$q$, t.id('A'), t.u(who)),
    '42501', format('AC4 %s cannot post in a chat', who));
  perform t.throws(format($q$insert into homework (student_id, course_id, assignment_id, title) values ('%s', '%s', '%s', 'x')$q$,
    t.u(who), t.id('A'), t.assignment(t.id('A'), 1)), '42501', format('AC4 %s cannot send homework', who));
  perform t.throws(format($q$insert into courses (title, created_by) values ('x', '%s')$q$, t.u(who)), '42501',
    format('AC4 %s cannot create a course', who));
  perform t.throws(format($q$insert into course_members (course_id, user_id, added_by) values ('%s', '%s', '%s')$q$,
    t.id('A'), t.u(who), t.u(who)), '42501', format('AC4 %s cannot join a course', who));
  perform t.throws($q$select mark_attendance('00000000-0000-0000-0000-0000000004b1')$q$, '42501',
    format('AC4 %s cannot mark attendance', who));
  perform t.throws(format($q$select mark_chat_read('%s', (select id from course_messages limit 1))$q$, t.id('A')), '42501',
    format('AC4 %s cannot mark a chat read', who));
  perform t.throws(format($q$select set_access_status('%s', 'approved')$q$, t.u(who)), '42501',
    format('AC7 %s cannot approve themselves', who));
  perform t.throws(format($q$select set_user_role('%s', 'mentor')$q$, t.u(who)), '42501', format('AC4 %s cannot change roles', who));
  perform t.throws(format($q$select change_course_owner('%s', '%s')$q$, t.id('A'), t.u(who)), '42501',
    format('AC4 %s cannot change an owner', who));
  perform t.throws(format($q$update profiles set access_status = 'approved' where id = '%s'$q$, t.u(who)), '42501',
    format('AC7 %s cannot change their own status directly', who));
  perform t.throws(format($q$update profiles set role = 'mentor' where id = '%s'$q$, t.u(who)), '42501',
    format('AC4 %s cannot change their own role', who));
  reset role;
end $$;
grant execute on function t.denied(text) to anon, authenticated;
reset role;
select t.denied('P');
select t.denied('R');

-- AC 8: not usable before approval.
select t.login('M');
select t.throws($$insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.u('P'), t.id('M'))$$, '42501',
  'AC8 a pending account cannot be added as a listener');
select t.login('T');
select t.throws($$select set_user_role(t.u('P'), 'mentor')$$, '23514', 'AC8 a pending account cannot be made a mentor');
select t.throws($$select change_course_owner(t.id('A'), t.u('R'))$$, '23514', 'AC8 a declined account cannot own a course');

-- AC 6 / AC 2: accepting gives the normal student app; a declined account can still be accepted.
select t.lives($$select set_access_status(t.u('P'), 'approved')$$, 'AC6 the teacher accepts P');
select t.lives($$select set_access_status(t.u('P'), 'approved')$$, 'AC6 accepting again is a no-op (retry)');
select t.eq((select string_agg(full_name, ',') from access_requests()), 'Rejected Rae', 'AC5 P leaves the requests list');
select t.login_new('P');
select t.eq((select role::text from profiles where id = t.u('P')), 'student', 'AC6 an accepted account is a student');
select t.eq((select count(*) from courses), 2::bigint, 'AC2 an accepted student sees the courses');
select t.eq((select count(*) from materials), 1::bigint, 'AC2 and the blog');
select t.eq((select count(*) from material_files), 1::bigint, 'AC2 and the Knowledge base');
select t.eq((select count(*) from storage.objects where bucket_id = 'materials'), 1::bigint, 'AC2 and its PDFs');
select t.eq((select count(*) from course_meetings), 0::bigint, 'AC2 but no course content: a student in no course yet');
select t.ok(not exists (select 1 from profiles where id = t.u('R')), 'AC2 an accepted student does not see declined accounts');
reset role;
select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.u('P'), t.id('M'))$$,
  'AC8 once accepted, P can be added as a listener');
select t.login('T');
select t.lives($$select set_access_status(t.u('R'), 'approved')$$, 'AC6 the teacher accepts a declined account');
select t.eq((select count(*) from access_requests()), 0::bigint, 'AC5 no requests left');

-- AC 9 / AC 7: the teacher is always approved, also for the one-time "make the first teacher" step.
reset role;
alter table profiles disable trigger profiles_teacher_locked;
update profiles set role = 'mentor' where id = t.id('T');
alter table profiles enable trigger profiles_teacher_locked;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000004a3', 'new@x.test', '{"full_name":"New Teacher"}');
update profiles set role = 'teacher' where id = '00000000-0000-0000-0000-0000000004a3';
select t.eq((select access_status::text from profiles where id = '00000000-0000-0000-0000-0000000004a3'), 'approved',
  'AC9 making the first teacher (manage-roles.sql) also approves them');
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc where proname = 'is_approved'),
  'data: is_approved is security definer with search_path = public');
