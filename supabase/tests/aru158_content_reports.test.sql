-- ARU-158: report content, the teacher's Reports list and chat message deletion.
-- Rules under test: supabase/migrations/0064_content_reports.sql.
-- Course A (owner M): listeners S1, S2. Course B (owner N) is hidden: listener S3 only. T is the teacher.
select t.seed();
create function t.r(n text) returns uuid language sql immutable as $$ select md5('aru158' || n)::uuid $$;
grant execute on function t.r(text) to anon, authenticated;

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; msg text; hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return concat_ws(' | ', code, hint);
end $$;
create function pg_temp.report(kind text, content uuid, reason text default 'offensive', note text default null)
  returns text language sql as $$
  select pg_temp.err(format('select report_content(%L, %L, %L, %L)', kind, content, reason, note)) $$;
-- Reports as the admin sees them (the tests read them without RLS).
create function pg_temp.reports(kind text, content uuid) returns setof content_reports language sql security definer as $$
  select * from public.content_reports where content_kind = kind and content_id = content order by created_at, id $$;
create function pg_temp.report_id(who text, kind text, content uuid) returns uuid language sql security definer as $$
  select id from public.content_reports where reporter_id = t.id(who) and content_kind = kind and content_id = content
  order by created_at desc limit 1 $$;
-- delete_content() as the app calls it: 't' (deleted), 'f' (already gone) or the error.
create function pg_temp.del(kind text, content uuid) returns text language plpgsql as $$
declare r boolean; code text; hint text;
begin
  execute format('select delete_content(%L, %L)', kind, content) into r;
  return case when r then 't' else 'f' end;
exception when others then
  get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
  return concat_ws(' | ', code, hint);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

update courses set hidden = true where id = t.id('B');
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  (t.id('B'), t.id('S3'), t.id('N'));

-- Content, made as the admin without triggers (no notifications).
set session_replication_role = replica;
insert into course_messages (id, course_id, author_id, body) values
  (t.r('mA1'), t.id('A'), t.id('S1'), 'Sam says something rude'),
  (t.r('mA2'), t.id('A'), t.id('S2'), 'Sue writes'),
  (t.r('mA3'), t.id('A'), t.id('S2'), 'Sue again'),
  (t.r('mGone'), t.id('A'), null, 'From a deleted account'),
  (t.r('mB1'), t.id('B'), t.id('S3'), 'Hidden course message');
insert into general_messages (id, author_id, body) values
  (t.r('g1'), t.id('S2'), 'General from Sue'),
  (t.r('gT'), t.id('T'), 'General from the teacher');
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (t.r('meet'), t.id('A'), '2026-11-10 10:00+00', 'completed', t.id('M'));
insert into meeting_listener_notes (id, meeting_id, course_id, author_id, body, is_public) values
  (t.r('nPub'), t.r('meet'), t.id('A'), t.id('S1'), 'Public notes', true),
  (t.r('nPriv'), t.r('meet'), t.id('A'), t.id('S2'), 'Private notes', false);
insert into materials (id, teacher_id, title, body) values (t.r('blog'), t.id('M'), 'Blog title', 'Blog body');
insert into material_files (id, author_id, name, description, storage_path, size_bytes) values
  (t.r('pdf'), t.id('M'), 'Guide.pdf', 'A guide', t.id('M') || '/' || t.r('pdf') || '.pdf', 100);
insert into course_feedback (id, course_id, user_id, rating, body) values
  (t.r('rev'), t.id('A'), t.id('S1'), 2, 'Meh course');
set session_replication_role = origin;

-- Data.
select t.ok(has_function_privilege('authenticated', 'report_content(text, uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'resolve_report(uuid, text)', 'execute'), 'data: the app can report and resolve');
select t.ok(not has_function_privilege('anon', 'report_content(text, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'resolve_report(uuid, text)', 'execute'), 'data: signed out can''t report or resolve');
select t.ok(not has_function_privilege('authenticated', 'report_content_exists(text, uuid)', 'execute'),
  'data: the existence helper is internal');
select t.eq((select string_agg(a.attname || '=' || c.confdeltype::text, ',' order by a.attname) from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.conrelid = 'content_reports'::regclass and c.contype = 'f' and a.attname <> 'workspace_id'),
  'author_id=n,reporter_id=n,resolved_by=n', 'data: user references are on delete set null (ARU-75)');
select t.ok((select relrowsecurity from pg_class where oid = 'content_reports'::regclass), 'data: RLS is on');
select t.ok(exists (select 1 from pg_policies where tablename = 'content_reports' and permissive = 'RESTRICTIVE'
  and policyname = 'workspace: only my workspace'), 'data: restrictive workspace policy');
select t.ok(exists (select 1 from pg_trigger where tgrelid = 'content_reports'::regclass and tgname = 'zz_workspace_guard'),
  'data: workspace guard');
select t.ok(has_function_privilege('authenticated', 'delete_content(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'delete_content(text, uuid)', 'execute'), 'data: delete_content for signed-in users only');
select t.eq((select count(*) from pg_policies where tablename in ('course_messages', 'general_messages', 'materials', 'course_feedback')
  and cmd = 'DELETE' and policyname not in ('authors delete own materials', 'listeners delete own feedback')), 0::bigint,
  'data: no new delete policy');

-- AC 1 / 4: report someone else's content I can see; the text and author are saved.
select t.login('S2');
select t.eq(pg_temp.report('course_message', t.r('mA1'), 'offensive', '  Rude  '), 'no error', 'AC1 a student reports a course message');
reset role;
select t.ok((select r.content_text = 'Sam says something rude' and r.author_id = t.id('S1') and r.reporter_id = t.id('S2')
  and r.course_id = t.id('A') and r.course_title = 'Algebra' and r.status = 'open' and r.comment = 'Rude'
  and r.reason = 'offensive' from pg_temp.reports('course_message', t.r('mA1')) r), 'AC4 text, author, place and comment saved');

-- AC 3: a second open report by the same person is refused.
select t.login('S2');
select t.eq(pg_temp.report('course_message', t.r('mA1'), 'spam'), '23505 | sham:report_duplicate', 'AC3 duplicate refused');
reset role;
select t.eq((select count(*) from pg_temp.reports('course_message', t.r('mA1'))), 1::bigint, 'AC3 still one report');

-- AC 4: own content, content I can't see, a deleted account's content, content that no longer exists.
select t.login('S1');
select t.eq(pg_temp.report('course_message', t.r('mA1')), '42501 | sham:report_not_allowed', 'AC4 own message refused');
select t.eq(pg_temp.report('meeting_note', t.r('nPriv')), '42501 | sham:report_not_allowed', 'AC4 someone else''s private note refused');
select t.eq(pg_temp.report('course_message', t.r('mB1')), '42501 | sham:report_not_allowed',
  'AC4 a hidden course''s message refused to a non-participant');
select t.eq(pg_temp.report('course_message', t.r('mGone')), '42501 | sham:report_not_allowed', 'AC1 a deleted account''s message refused');
select t.eq(pg_temp.report('course_message', t.r('nothing')), 'P0002 | sham:report_content_missing', 'AC4 missing content');
select t.eq(pg_temp.report('review', t.r('mA2')), 'P0002 | sham:report_content_missing', 'AC4 an id of another kind is missing');
select t.eq(pg_temp.report('homework', t.id('HW_A1')), 'P0002 | sham:report_content_missing', 'AC4 an unknown kind is refused');
select t.login('M2');
select t.eq(pg_temp.report('course_message', t.r('mA2')), '42501 | sham:report_not_allowed', 'AC4 a mentor outside the course can''t see its chat');
select t.login('S3');
select t.eq(pg_temp.report('course_message', t.r('mB1')), '42501 | sham:report_not_allowed', 'AC4 own message in the hidden course');
select t.eq(pg_temp.report('review', t.r('rev')), 'no error', 'AC1 a student outside the course reports a visible review');
reset role;

-- AC 2: reason and comment.
select t.login('S1');
select t.eq(pg_temp.report('course_message', t.r('mA2'), 'rude'), '22023 | sham:report_reason', 'AC2 unknown reason refused');
select t.eq(pg_temp.report('course_message', t.r('mA2'), null), '22023 | sham:report_reason', 'AC2 no reason refused');
select t.eq(pg_temp.report('course_message', t.r('mA2'), 'spam', repeat('я', 501)), '22001 | sham:report_comment_too_long',
  'AC2 501 characters refused');
select t.eq(pg_temp.report('course_message', t.r('mA2'), 'spam', repeat('я', 500)), 'no error', 'AC2 500 characters accepted');
select t.eq(pg_temp.report('course_message', t.r('mA3'), 'other', '   '), 'no error', 'AC2 a blank comment is no comment');

-- AC 1 / 4: every kind, with its saved text.
select t.eq(pg_temp.report('meeting_note', t.r('nPriv')), '42501 | sham:report_not_allowed', 'AC4 still can''t see the private note');
select t.eq(pg_temp.report('blog_post', t.r('blog'), 'spam'), 'no error', 'AC1 report a Blog post');
select t.eq(pg_temp.report('pdf', t.r('pdf'), 'harassment'), 'no error', 'AC1 report a PDF');
select t.eq(pg_temp.report('general_message', t.r('g1')), 'no error', 'AC1 report a general chat message');
select t.eq(pg_temp.report('general_message', t.r('gT')), 'no error', 'AC1 report the teacher''s message');
select t.login('S2');
select t.eq(pg_temp.report('meeting_note', t.r('nPub')), 'no error', 'AC1 report a public meeting note');
select t.eq(pg_temp.report('review', t.r('rev')), 'no error', 'AC1 report a review');
select t.eq(pg_temp.report('general_message', t.r('gT')), 'no error', 'AC1 a second person reports the same message');
select t.login('M');
select t.eq(pg_temp.report('course_message', t.r('mA3')), 'no error', 'AC1 a mentor reports');
reset role;
select t.ok((select r.content_title = 'Blog title' and r.content_text = 'Blog body' and r.author_id = t.id('M')
  and r.course_id is null from pg_temp.reports('blog_post', t.r('blog')) r), 'AC4 Blog post: title and text');
select t.ok((select r.content_title = 'Guide.pdf' and r.content_text = 'A guide' from pg_temp.reports('pdf', t.r('pdf')) r),
  'AC4 PDF: name and description');
select t.ok((select bool_and(r.content_rating = 2 and r.content_text = 'Meh course' and r.course_title = 'Algebra')
  from pg_temp.reports('review', t.r('rev')) r), 'AC4 review: stars and text');
select t.ok((select r.meeting_at = '2026-11-10 10:00+00' and r.course_id = t.id('A')
  from pg_temp.reports('meeting_note', t.r('nPub')) r), 'AC6 note: the meeting''s date');

-- AC 4: the report keeps the text after the content changes.
update course_feedback set body = 'Changed', rating = 5 where id = t.r('rev');
select t.ok((select bool_and(r.content_text = 'Meh course' and r.content_rating = 2) from pg_temp.reports('review', t.r('rev')) r),
  'AC4 an edit doesn''t change the report');

-- Waiting accounts and direct writes.
update profiles set access_status = 'pending' where id = t.id('S3');
select t.login('S3');
select t.eq(pg_temp.report('general_message', t.r('g1')), '42501 | sham:not_approved', 'access: a waiting account can''t report');
reset role;
update profiles set access_status = 'approved' where id = t.id('S3');
select t.login('S1');
select t.throws(format($$insert into content_reports (reporter_id, content_kind, content_id, reason) values (%L, 'review', %L, 'spam')$$,
  t.id('S1'), t.r('rev')), '42501', 'AC4 no direct insert');
select t.throws(format($$update content_reports set status = 'dismissed'$$), '42501', 'access: no direct update');
select t.login(null);
select t.throws(format('select report_content(%L, %L, %L)', 'review', t.r('rev'), 'spam'), '42501', 'access: signed out can''t report');

-- AC 5 / 6: only the teacher reads reports.
select t.login('S2');
select t.eq((select count(*) from content_reports), 0::bigint, 'AC5 a student reads no reports');
select t.login('M');
select t.eq((select count(*) from content_reports), 0::bigint, 'AC5 a mentor reads no reports, not even their own');
select t.login('T');
select t.eq((select count(*) from content_reports), 12::bigint, 'AC5 the teacher reads every report of the workspace');

-- AC 8 / 9: resolve.
select t.login('S1');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S2', 'course_message', t.r('mA1')), 'dismissed')),
  '42501 | sham:report_teacher_only', 'access: a student can''t resolve');
select t.login('M');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S2', 'course_message', t.r('mA1')), 'dismissed')),
  '42501 | sham:report_teacher_only', 'access: a course owner can''t resolve');
select t.login('T');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S2', 'course_message', t.r('mA1')), 'open')),
  '22023 | sham:report_status_values', 'resolve: only removed or dismissed');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', t.r('nothing'), 'dismissed')),
  'P0002 | sham:report_not_found', 'resolve: unknown report');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S2', 'course_message', t.r('mA1')), 'dismissed')),
  'no error', 'AC8 the teacher dismisses');
reset role;
select t.ok((select r.status = 'dismissed' and r.resolved_by = t.id('T') and r.resolved_at is not null
  from pg_temp.reports('course_message', t.r('mA1')) r), 'AC8 dismissed, with who and when');
select t.ok(exists (select 1 from course_messages where id = t.r('mA1')), 'AC8 the content stays');
select t.login('T');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S2', 'course_message', t.r('mA1')), 'removed')),
  'no error', 'edge: resolving a resolved report is no error');
reset role;
select t.eq((select r.status from pg_temp.reports('course_message', t.r('mA1')) r), 'dismissed', 'edge: and changes nothing');
select t.login('S2');
select t.eq(pg_temp.report('course_message', t.r('mA1'), 'spam'), 'no error', 'AC3 after a dismissal I can report again');

-- AC 9: a report about the teacher's own content.
select t.login('T');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S1', 'general_message', t.r('gT')), 'dismissed')),
  '42501 | sham:report_dismiss_own', 'AC9 the teacher can''t dismiss a report about themselves');
-- AC 7: Removed only once the content is gone.
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S1', 'general_message', t.r('gT')), 'removed')),
  '23514 | sham:report_content_exists', 'AC7 removed needs the content deleted first');
select t.eq(pg_temp.del('general_message', t.r('gT')), 't',
  'AC7/11 the teacher deletes a general chat message');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S1', 'general_message', t.r('gT')), 'removed')),
  'no error', 'AC7/9 Delete content on their own content');
reset role;
select t.ok((select bool_and(r.status = 'removed' and r.resolved_by = t.id('T') and r.resolved_at is not null)
  and count(*) = 2 from pg_temp.reports('general_message', t.r('gT')) r), 'AC7 every open report on it is Removed');
select t.ok((select r.content_text = 'General from the teacher' from pg_temp.reports('general_message', t.r('gT')) r limit 1),
  'AC4 the report stays readable after the content is deleted');
-- AC 7: content its author already deleted: Removed, no error.
delete from materials where id = t.r('blog');
select t.login('T');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S1', 'blog_post', t.r('blog')), 'removed')),
  'no error', 'AC7 content already gone: Removed without an error');
reset role;
select t.eq((select r.status from pg_temp.reports('blog_post', t.r('blog')) r), 'removed', 'AC7 Removed');
select t.login('S1');
select t.eq(pg_temp.report('blog_post', t.r('blog')), 'P0002 | sham:report_content_missing', 'edge: deleted content can''t be reported');

-- AC 11: deleting chat messages.
select t.login('S1');
select t.eq(pg_temp.del('course_message', t.r('mA1')), '42501 | sham:content_cant_delete', 'AC11 a student can''t delete own message');
select t.eq(pg_temp.del('course_message', t.r('mA2')), '42501 | sham:content_cant_delete', 'AC11 nor someone else''s');
select t.eq(pg_temp.del('general_message', t.r('g1')), '42501 | sham:content_cant_delete', 'AC11 nor a general message');
select t.login('S2');
select t.eq(pg_temp.del('general_message', t.r('g1')), '42501 | sham:content_cant_delete', 'AC11 not even own general message');
select t.login('M2');
select t.eq(pg_temp.del('course_message', t.r('mA2')), '42501 | sham:content_cant_delete', 'AC11 a mentor who isn''t the owner can''t');
select t.login('N');
select t.eq(pg_temp.del('course_message', t.r('mA2')), '42501 | sham:content_cant_delete', 'AC11 another course''s owner can''t');
select t.login('M');
select t.eq(pg_temp.del('general_message', t.r('g1')), '42501 | sham:content_cant_delete', 'AC11 an owner can''t delete general messages');
select t.eq(pg_temp.del('course_message', t.r('mB1')), '42501 | sham:content_cant_delete', 'AC11 an owner can''t delete in another course');
select t.eq(pg_temp.del('course_message', t.r('mA2')), 't', 'AC11 the owner deletes in their course chat');
select t.login('T');
select t.eq(pg_temp.del('course_message', t.r('mB1')), 't',
  'AC11 the teacher deletes in any course chat, hidden ones too');
reset role;
-- AC 11: a former owner loses the right.
update courses set created_by = t.id('N') where id = t.id('A');
select t.login('M');
select t.eq(pg_temp.del('course_message', t.r('mA3')), '42501 | sham:content_cant_delete', 'AC11 a former owner can''t');
select t.login('N');
select t.eq(pg_temp.del('course_message', t.r('mA3')), 't', 'AC11 the new owner can');

-- AC 7: the teacher deletes any Blog post and review; others still can't.
reset role;
set session_replication_role = replica;
insert into materials (id, teacher_id, title, body) values (t.r('blog2'), t.id('M'), 'Another', 'Post');
set session_replication_role = origin;
select t.login('S2');
select t.eq(pg_temp.del('review', t.r('rev')), '42501 | sham:content_cant_delete', 'access: a student can''t delete someone''s review');
select t.login('N');
select t.eq(pg_temp.del('blog_post', t.r('blog2')), '42501 | sham:content_cant_delete', 'access: a mentor can''t delete someone''s post');
select t.login('T');
select t.eq(pg_temp.del('blog_post', t.r('blog2')), 't', 'AC7 the teacher deletes any Blog post');
select t.eq(pg_temp.del('review', t.r('rev')), 't', 'AC7 the teacher deletes any review');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S2', 'review', t.r('rev')), 'removed')),
  'no error', 'AC7 the review''s reports become Removed');
reset role;
select t.ok((select bool_and(status = 'removed') and count(*) = 2 from pg_temp.reports('review', t.r('rev'))),
  'AC7 both reports on the review are Removed');
select t.login('T');
select t.eq(pg_temp.del('review', t.r('rev')), 'f', 'AC7 already gone: no error');
select t.eq(pg_temp.del('homework', t.id('HW_A1')), '42501 | sham:content_cant_delete', 'access: only the four kinds');
-- Direct deletes keep their earlier rules (no new delete policy).
select t.eq(t.affected(format('delete from course_messages where id = %L', t.r('mA1'))), 0::bigint,
  'regression: the teacher still can''t delete a message directly');
select t.eq(t.affected(format('delete from general_messages where id = %L', t.r('g1'))), 0::bigint,
  'regression: nor a general message directly');
-- Existing author rules unchanged.
select t.login('S1');
select t.eq(pg_temp.err(format('select delete_meeting_listener_notes(%L)', t.r('nPub'))), 'no error', 'regression: an author still deletes own notes');

-- Workspaces: another workspace's teacher sees and resolves nothing here.
reset role;
insert into workspaces (id, name, created_at) values (t.r('W2'), 'Other school', now());
insert into auth.users (id, email, raw_user_meta_data) values (t.r('XT'), 'xt@x.test', '{"full_name":"Xena Teacher"}');
update profiles set workspace_id = t.r('W2'), access_status = 'approved' where id = t.r('XT');
update profiles set role = 'teacher' where id = t.r('XT');
select set_config('request.jwt.claims', json_build_object('sub', t.r('XT'), 'role', 'authenticated')::text, false);
set role authenticated;
select t.eq((select count(*) from content_reports), 0::bigint, 'workspaces: another teacher reads none of these reports');
select t.eq(pg_temp.err(format('select resolve_report(%L, %L)', pg_temp.report_id('S1', 'pdf', t.r('pdf')), 'dismissed')),
  'P0002 | sham:report_not_found', 'workspaces: nor resolves them');
select t.eq(pg_temp.report('pdf', t.r('pdf')), '42501 | sham:report_not_allowed', 'workspaces: nor reports another workspace''s content');
select t.eq(pg_temp.del('general_message', t.r('g1')), '42501 | sham:content_cant_delete',
  'workspaces: nor deletes its chat messages');
reset role;
select t.ok(exists (select 1 from general_messages where id = t.r('g1')), 'workspaces: the message stays');
