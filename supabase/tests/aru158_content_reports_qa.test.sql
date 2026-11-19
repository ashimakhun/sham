-- QA ARU-158: gaps in aru158_content_reports.test.sql: another workspace (report, read, resolve, delete by a guessed
-- id), waiting and declined accounts, signed-out callers, an account deletion of the reporter or the author (the report
-- stays and can still be resolved), resolving twice, a course-only PDF of another course, a private note in a hidden
-- course, the new functions' settings (security definer, fixed search_path, nothing callable signed out).
-- Fixture (t.seed): course A owned by M (listeners S1, S2), course B owned by N; teacher T. Added: workspace W2 with
-- teacher XT and student XS, a W2 course message; P1 waiting, D1 declined (both first workspace).
select t.seed();
create function t.q(n text) returns uuid language sql immutable as $$ select md5('aru158qa' || n)::uuid $$;
grant execute on function t.q(text) to anon, authenticated;

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return concat_ws(' | ', code, hint);
end $$;
create function pg_temp.as_user(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
-- Reports as the admin sees them.
create function pg_temp.status_of(rid uuid) returns text language sql security definer as $$
  select coalesce((select status || ':' || coalesce(reporter_id::text, 'null') || ':' || coalesce(author_id::text, 'null')
    from public.content_reports where id = rid), 'gone') $$;
create function pg_temp.count_reports() returns bigint language sql security definer as $$
  select count(*) from public.content_reports $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('S2'), t.id('M'));
update courses set hidden = true where id = t.id('B');
insert into course_members (course_id, user_id, added_by) values (t.id('B'), t.id('S3'), t.id('N'));

-- Waiting (P1) and declined (D1) accounts in the first workspace; D1 was a listener of A before being declined.
insert into auth.users (id, email, raw_user_meta_data) values
  (t.q('P1'), 'qp1@x.test', '{"full_name":"Pat Pending"}'),
  (t.q('D1'), 'qd1@x.test', '{"full_name":"Dan Declined"}');
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.q('D1'), t.id('M'));
update profiles set access_status = 'rejected' where id = t.q('D1');

-- Workspace W2 (as the admin, moved like in aru145_workspaces_qa).
insert into workspaces (id, name, created_at) values (t.q('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values
  (t.q('XT'), 'qxt158@x.test', '{"full_name":"Xena Teacher"}'),
  (t.q('XS'), 'qxs158@x.test', '{"full_name":"Xia Student"}');
update profiles set workspace_id = t.q('W2') where id in (t.q('XT'), t.q('XS'));
update profiles set access_status = 'approved' where id in (t.q('XT'), t.q('XS'));
update profiles set role = 'teacher' where id = t.q('XT');
insert into courses (id, title, created_by) values (t.q('XC'), 'Xcourse', t.q('XT'));
insert into course_members (course_id, user_id, added_by) values (t.q('XC'), t.q('XS'), t.q('XT'));

set session_replication_role = replica;
insert into course_messages (id, course_id, author_id, body) values
  (t.q('mA'), t.id('A'), t.id('S2'), 'Sue in A'),
  (t.q('mA2'), t.id('A'), t.id('S2'), 'Sue again in A'),
  (t.q('mB'), t.id('B'), t.id('S3'), 'Sid in hidden B'),
  (t.q('mX'), t.q('XC'), t.q('XS'), 'Xia in W2');
update course_messages set workspace_id = t.q('W2') where id = t.q('mX');
insert into general_messages (id, author_id, body, workspace_id) values (t.q('gX'), t.q('XS'), 'Xia general', t.q('W2'));
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.q('meetB'), t.id('B'), now() - interval '1 day', 'completed', t.id('N'));
insert into meeting_listener_notes (id, meeting_id, course_id, author_id, body, is_public) values
  (t.q('nB'), t.q('meetB'), t.id('B'), t.id('S3'), 'Public note in hidden B', true);
insert into material_files (id, author_id, name, description, storage_path, size_bytes, course_id, course_only) values
  (t.q('pdfB'), t.id('N'), 'B only.pdf', 'For B', t.id('N') || '/' || t.q('pdfB') || '.pdf', 100, t.id('B'), true);
set session_replication_role = origin;

-- Function settings: every new function is security definer with a fixed search_path; none is callable signed out
-- (ARU-154 rule); the existence helper isn't callable by app users either.
select t.eq((select string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-'), ' ' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('report_content', 'resolve_report', 'delete_content', 'report_content_exists')),
  'delete_content:true:search_path=public report_content:true:search_path=public report_content_exists:true:search_path=public resolve_report:true:search_path=public',
  'functions: security definer, search_path=public');
select t.eq((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')), 0::bigint,
  'functions: no security definer function in public is callable signed out (ARU-154 still holds)');
select t.ok(not has_function_privilege('anon', 'delete_content(text, uuid)', 'execute'), 'signed out can''t call delete_content');
select t.ok(not has_function_privilege('authenticated', 'report_content_exists(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'report_content_exists(text, uuid)', 'execute'), 'report_content_exists stays internal');
select t.ok(not has_table_privilege('anon', 'content_reports', 'select'), 'signed out: no read grant on content_reports');

-- Signed out: every call refused, nothing written.
select t.login(null);
select t.ok(pg_temp.err(format('select report_content(%L, %L, %L)', 'course_message', t.q('mA'), 'spam')) like '42501%',
  'signed out: report_content refused');
select t.ok(pg_temp.err(format('select delete_content(%L, %L)', 'course_message', t.q('mA'))) like '42501%',
  'signed out: delete_content refused');
reset role;

-- Waiting and declined accounts can do none of this.
select pg_temp.as_user(t.q('P1'));
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'general_message', t.q('gX'), 'spam')),
  '42501 | sham:not_approved', 'waiting: report refused (not approved)');
reset role;
select pg_temp.as_user(t.q('D1'));
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'course_message', t.q('mA'), 'spam')),
  '42501 | sham:not_approved', 'declined former listener: report refused');
select t.eq((select count(*) from content_reports), 0::bigint, 'declined: reads no reports');
reset role;
select t.eq(pg_temp.count_reports(), 0::bigint, 'nothing written by signed out, waiting or declined accounts');

-- Another workspace, by a guessed id: W2's student can't report W1 content, and W1's people can't report W2 content.
select pg_temp.as_user(t.q('XS'));
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'course_message', t.q('mA'), 'spam')),
  '42501 | sham:report_not_allowed', 'W2 student: W1 course message refused');
reset role;
select t.login('S1');
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'general_message', t.q('gX'), 'spam')),
  '42501 | sham:report_not_allowed', 'W1 student: W2 general message refused');
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'course_message', t.q('mX'), 'spam')),
  '42501 | sham:report_not_allowed', 'W1 student: W2 course message refused');
reset role;
select t.login('T');
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'course_message', t.q('mX'), 'spam')),
  '42501 | sham:report_not_allowed', 'W1 teacher: W2 course message refused');
select t.eq(pg_temp.err(format('select delete_content(%L, %L)', 'course_message', t.q('mX'))),
  '42501 | sham:content_cant_delete', 'W1 teacher: can''t delete a W2 course message');
select t.eq(pg_temp.err(format('select delete_content(%L, %L)', 'general_message', t.q('gX'))),
  '42501 | sham:content_cant_delete', 'W1 teacher: can''t delete a W2 general message');
reset role;
select t.eq((select count(*) from course_messages where id = t.q('mX')) + (select count(*) from general_messages where id = t.q('gX')),
  2::bigint, 'W2 messages still there');

-- Hidden course B: a listener of A can't report B's message or B's public note; a course-only PDF of B is refused too.
select t.login('S1');
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'course_message', t.q('mB'), 'spam')),
  '42501 | sham:report_not_allowed', 'hidden course: message refused for a non-participant');
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'meeting_note', t.q('nB'), 'spam')),
  '42501 | sham:report_not_allowed', 'hidden course: public note refused for a non-participant');
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'pdf', t.q('pdfB'), 'spam')),
  '42501 | sham:report_not_allowed', 'course-only PDF of another course refused');
reset role;
-- B's listener can report the note; the teacher reads it with B's title.
select t.login('S3');
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'pdf', t.q('pdfB'), 'other')), 'no error',
  'hidden course: its listener reports the course-only PDF');
reset role;

-- Reports in both workspaces; each teacher reads, resolves and deletes only their own.
select t.login('S1');
select t.ok(report_content('course_message', t.q('mA'), 'harassment', 'please look') is not null, 'S1 reports Sue in A');
reset role;
select pg_temp.as_user(t.q('XS'));
select t.eq(pg_temp.err(format('select report_content(%L, %L, %L)', 'course_message', t.q('mX'), 'spam')),
  '42501 | sham:report_not_allowed', 'W2 student: own message refused');
reset role;
-- A W2 report made as the admin (W2 has a single student; the function path is covered above).
insert into content_reports (reporter_id, content_kind, content_id, author_id, content_text, course_id, reason)
  values (t.q('XT'), 'course_message', t.q('mX'), t.q('XS'), 'Xia in W2', t.q('XC'), 'spam');
select t.eq((select workspace_id from content_reports where content_id = t.q('mX')), t.q('W2'),
  'the guard puts a W2 reporter''s report in W2');

select t.login('T');
select t.eq((select count(*) from content_reports where workspace_id = t.q('W2')), 0::bigint, 'W1 teacher reads no W2 report');
select t.eq((select count(*) from content_reports), 2::bigint, 'W1 teacher reads both W1 reports');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', t.q('nope'), 'dismissed')),
  'P0002 | sham:report_not_found', 'resolve an unknown id: not found');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)',
  (select id from public.content_reports where content_id = t.q('mX')), 'dismissed')),
  'P0002 | sham:report_not_found', 'W1 teacher: a W2 report id is "not found", nothing changes');
reset role;
select t.eq(pg_temp.status_of((select id from public.content_reports where content_id = t.q('mX'))),
  'open:' || t.q('XT') || ':' || t.q('XS'), 'the W2 report is still open');
select pg_temp.as_user(t.q('XT'));
select t.eq((select count(*) from content_reports), 1::bigint, 'W2 teacher reads only W2''s report');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)',
  (select id from public.content_reports where content_id = t.q('mA')), 'dismissed')),
  'P0002 | sham:report_not_found', 'W2 teacher: a W1 report id is "not found"');
select t.eq(pg_temp.err(format('select delete_content(%L, %L)', 'course_message', t.q('mA'))),
  '42501 | sham:content_cant_delete', 'W2 teacher: can''t delete the reported W1 message');
reset role;
select t.eq((select count(*) from course_messages where id = t.q('mA')), 1::bigint, 'the W1 message is still there');

-- Mentors and students can't resolve or delete, even with the report id.
select t.login('M');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)',
  (select id from public.content_reports where content_id = t.q('mA')), 'dismissed')),
  '42501 | sham:report_teacher_only', 'the course owner can''t resolve reports');
reset role;
select t.login('S1');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)',
  (select id from public.content_reports where content_id = t.q('mA')), 'removed')),
  '42501 | sham:report_teacher_only', 'the reporter can''t resolve their report');
select pg_temp.err(format('update content_reports set status = %L', 'dismissed'));
select pg_temp.err(format('delete from content_reports where content_id = %L', t.q('mA')));
reset role;
select t.eq(pg_temp.status_of((select id from public.content_reports where content_id = t.q('mA'))),
  'open:' || t.id('S1') || ':' || t.id('S2'), 'a direct update or delete by the reporter changes nothing');

-- A declined course owner loses the right to delete in their chat (owns_course needs approval).
update profiles set access_status = 'rejected' where id = t.id('M');
select t.login('M');
select t.eq(pg_temp.err(format('select delete_content(%L, %L)', 'course_message', t.q('mA2'))),
  '42501 | sham:content_cant_delete', 'declined course owner: can''t delete in the course chat');
reset role;
update profiles set access_status = 'approved' where id = t.id('M');

-- Account deletion (ARU-75): the reporter's and the author's accounts go; the report stays, shows nulls and can still
-- be resolved by the teacher.
delete from auth.users where id = t.id('S1');
select t.eq(pg_temp.status_of((select id from public.content_reports where content_id = t.q('mA'))),
  'open:null:' || t.id('S2'), 'reporter deleted: the report stays, reporter null');
delete from auth.users where id = t.id('S2');
select t.eq(pg_temp.status_of((select id from public.content_reports where content_id = t.q('mA'))),
  'open:null:null', 'author deleted too: the report stays, author null');
select t.eq((select content_text from content_reports where content_id = t.q('mA')), 'Sue in A',
  'the saved text survives both deletions');
select t.login('T');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)',
  (select id from public.content_reports where content_id = t.q('mA')), 'dismissed')), 'no error',
  'the teacher dismisses a report whose reporter and author are deleted');
-- Resolving it again changes nothing and raises nothing.
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)',
  (select id from public.content_reports where content_id = t.q('mA')), 'removed')), 'no error',
  'resolving an already resolved report: no error');
reset role;
select t.eq(pg_temp.status_of((select id from public.content_reports where content_id = t.q('mA'))),
  'dismissed:null:null', 'it stays Dismissed (the second call changed nothing)');
select t.eq((select resolved_by from content_reports where content_id = t.q('mA')), t.id('T'), 'resolved by the teacher');
