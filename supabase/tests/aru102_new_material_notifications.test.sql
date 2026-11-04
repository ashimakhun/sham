-- ARU-102: new_material_recipients(), the New materials switch and the after-insert triggers on materials and
-- material_files that queue the pg_net call. Rules under test: supabase/migrations/0048_new_material_notifications.sql.
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2; students S1, S2, S3. Here: course A has listeners
-- S1 and M2, and the Pending account P and the Rejected account R. Everyone but S3 has a Telegram link (all switches on).
select t.seed();
create function t.mid(name text) returns uuid language sql immutable as $$ select md5('aru102-' || name)::uuid $$;
grant execute on function t.mid(text) to anon, authenticated, service_role;
-- Fixture people plus P and R (not in t.id()).
create function t.u(name text) returns uuid language sql immutable as $$ select coalesce(t.id(name), t.mid(name)) $$;
grant execute on function t.u(text) to anon, authenticated, service_role;
insert into auth.users (id, email, raw_user_meta_data) values
  (t.u('P'), 'p@x.test', '{"full_name":"Pending Pat"}'),
  (t.u('R'), 'r@x.test', '{"full_name":"Rejected Ray"}');
set session_replication_role = replica;
update profiles set access_status = 'pending' where id = t.u('P');
update profiles set access_status = 'rejected' where id = t.u('R');
set session_replication_role = origin;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.u('P'), t.id('M')),
  (t.id('A'), t.u('R'), t.id('M'));
insert into telegram_links (user_id, chat_id) values
  (t.id('T'), 3001), (t.id('M'), 3002), (t.id('N'), 3003), (t.id('M2'), 3004),
  (t.id('S1'), 3005), (t.id('S2'), 3006), (t.u('P'), 3007), (t.u('R'), 3008);

grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- Share as a user (through RLS).
create function t.blog(who text, name text, title text) returns text language sql as $$
  select format('insert into materials (id, teacher_id, title, body) values (%L, %L, %L, %L)',
    t.mid(name), t.id(who), title, 'Body text')
$$;
create function t.pdf(who text, name text, file_name text, course text, course_only boolean) returns text language sql as $$
  select format(
    'insert into material_files (id, author_id, name, description, course_id, course_only, storage_path, size_bytes) '
    'values (%L, %L, %L, %L, %L, %L, %L, 10)',
    t.mid(name), t.id(who), file_name, 'A description', case when course is null then null else t.id(course) end,
    course_only, t.id(who)::text || '/' || t.mid(name)::text || '.pdf')
$$;

-- "<author>|<title>: <recipients, sorted>" or '' when nobody gets it. Called as the service role.
create function t.recipients(kind text, item uuid) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select coalesce(min(r.author_name) || '|' || min(r.item_title) || ': ' || string_agg(coalesce(
           (select k from unnest(array['T','M','N','M2','S1','S2','S3','P','R']) k where t.u(k) = r.user_id), '?'),
           ',' order by (select k from unnest(array['T','M','N','M2','S1','S2','S3','P','R']) k where t.u(k) = r.user_id)), '')
    into result from new_material_recipients(kind, item) r;
  reset role;
  return result;
end $$;
grant execute on function t.recipients(text, uuid) to service_role;

create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant execute on function t.calls() to anon, authenticated, service_role;

-- AC 5: the column and the switch.
select t.ok((select bool_and(notify_new_material) from telegram_links), 'AC5 on by default for existing links');
select t.login('S1');
select t.lives('select set_telegram_notification(''new_material'', false)', 'AC5 a student turns it off');
reset role;
select t.ok(not (select notify_new_material from telegram_links where user_id = t.id('S1')), 'AC5 saved off');
select t.ok((select notify_new_material from telegram_links where user_id = t.id('S2')), 'AC5 only the caller''s row');
select t.ok((select notify_general_chat and notify_chat_message and notify_new_account and notify_homework_submitted
  from telegram_links where user_id = t.id('S1')), 'other switches untouched');
select t.login('S1');
select t.lives('select set_telegram_notification(''new_material'', true)', 'AC5 back on');
select t.lives('select set_telegram_notification(''general_chat'', true)', 'ARU-87 kind still works');
select t.lives('select set_telegram_notification(''homework_submitted'', true)', 'ARU-89 kind still works');
select t.lives('select set_telegram_notification(''new_account'', true)', 'ARU-84 kind still works');
select t.lives('select set_telegram_notification(''meeting_started'', true)', 'ARU-48 kind still works');
select t.throws('select set_telegram_notification(''nope'', true)', '22023', 'unknown kind is still an error');
reset role;

-- AC 10: grants.
select t.ok(not has_function_privilege('anon', 'new_material_recipients(text, uuid)', 'execute'), 'AC10 anon can''t run it');
select t.ok(not has_function_privilege('authenticated', 'new_material_recipients(text, uuid)', 'execute'),
  'AC10 app users can''t run it');
select t.ok(has_function_privilege('service_role', 'new_material_recipients(text, uuid)', 'execute'),
  'AC10 the service role can');
select t.ok(not has_function_privilege('anon', 'notify_new_blog_post()', 'execute')
  and not has_function_privilege('authenticated', 'notify_new_blog_post()', 'execute')
  and not has_function_privilege('anon', 'notify_new_material_file()', 'execute')
  and not has_function_privilege('authenticated', 'notify_new_material_file()', 'execute')
  and not has_function_privilege('authenticated', 'queue_new_material_notification(text, uuid)', 'execute'),
  'the trigger functions aren''t executable by anon or app users');
select t.ok((select bool_and(prosecdef and 'search_path=public' = any(proconfig)) from pg_proc
  where oid in ('notify_new_blog_post()'::regprocedure, 'notify_new_material_file()'::regprocedure,
                'new_material_recipients(text, uuid)'::regprocedure)),
  'security definer, search_path=public');
select t.login('M');
select t.throws(format('select * from new_material_recipients(''blog'', %L)', t.mid('x')), '42501', 'AC10 a mentor calling it is refused');
select t.login(null);
select t.throws(format('select * from new_material_recipients(''blog'', %L)', t.mid('x')), '42501', 'AC10 anon is refused');
reset role;

-- AC 8: no Vault secrets -> the post is saved, nothing queued.
select t.login('M');
select t.lives(t.blog('M', 'b1', 'Exam tips'), 'AC8 M shares a post with no Vault secrets');
reset role;
select t.ok(exists (select 1 from materials where id = t.mid('b1')), 'AC8 the post is saved');
select t.eq(t.calls(), 0::bigint, 'AC8 no secrets: no call');

-- AC 1 / AC 4 / AC 10: a Blog post goes to every Approved, linked account but the author.
select t.eq(t.recipients('blog', t.mid('b1')), 'Mentor Max|Exam tips: M2,N,S1,S2,T',
  'AC1/AC4 blog post: everyone Approved and linked but the author; not P, R or unlinked S3');
-- AC 5: a switch off -> left out; back on -> back in.
update telegram_links set notify_new_material = false where user_id = t.id('S2');
select t.eq(t.recipients('blog', t.mid('b1')), 'Mentor Max|Exam tips: M2,N,S1,T', 'AC5 switch off: left out');
update telegram_links set notify_new_material = true where user_id = t.id('S2');
select t.eq(t.recipients('blog', t.mid('nope')), '', 'AC10 unknown id: nothing');
select t.eq(t.recipients('file', t.mid('b1')), '', 'AC10 a blog id asked as a file: nothing');
select t.eq(t.recipients('video', t.mid('b1')), '', 'AC10 unknown type: nothing');

-- Only the URL -> still skipped.
insert into vault.decrypted_secrets values
  ('new_material_notify_url', 'https://example.supabase.co/functions/v1/new-material-notifications');
select t.login('T');
select t.lives(t.blog('T', 'b2', 'Week plan'), 'T shares a post with only the URL');
reset role;
select t.eq(t.calls(), 0::bigint, 'a missing secret: no call');
select t.eq(t.recipients('blog', t.mid('b2')), 'Teacher Tess|Week plan: M,M2,N,S1,S2', 'AC4 the teacher as author is left out');

-- AC 9: one call per insert, with the body, the header and a timeout.
insert into vault.decrypted_secrets values ('new_material_notify_secret', 's3cret');
select t.login('M');
select t.lives(t.blog('M', 'b3', 'Reading list'), 'M shares a post');
reset role;
select t.eq(t.calls(), 1::bigint, 'AC9 exactly one call');
select t.eq((select url from net.requests order by id desc limit 1),
  'https://example.supabase.co/functions/v1/new-material-notifications', 'posted to the Vault URL');
select t.eq((select body from net.requests order by id desc limit 1),
  jsonb_build_object('type', 'blog', 'id', t.mid('b3')), 'body is {"type": "blog", "id": "<id>"}');
select t.eq((select headers ->> 'Authorization' from net.requests order by id desc limit 1), 'Bearer s3cret',
  'Authorization: Bearer <secret>');
select t.eq((select timeout_milliseconds from net.requests order by id desc limit 1), 5000, 'explicit 5 s timeout');

-- AC 2 / AC 9: an Everyone PDF (no course, and on a course but not course-only) -> one call each, everyone gets it.
select t.login('M');
select t.lives(t.pdf('M', 'f1', 'Formulas.pdf', null, false), 'M adds a PDF with no course');
select t.lives(t.pdf('M', 'f2', 'Syllabus.pdf', 'A', false), 'M adds an Everyone PDF on A');
reset role;
select t.eq(t.calls(), 3::bigint, 'AC9 one call per PDF');
select t.eq((select body from net.requests order by id desc limit 1),
  jsonb_build_object('type', 'file', 'id', t.mid('f2')), 'body is {"type": "file", "id": "<id>"}');
select t.eq(t.recipients('file', t.mid('f1')), 'Mentor Max|Formulas.pdf: M2,N,S1,S2,T', 'AC2 no-course PDF: everyone');
select t.eq(t.recipients('file', t.mid('f2')), 'Mentor Max|Syllabus.pdf: M2,N,S1,S2,T', 'AC2 Everyone PDF on A: everyone');
select t.eq(t.recipients('blog', t.mid('f1')), '', 'a file id asked as a blog post: nothing');

-- AC 3: a course-only PDF on A by N (not in A) -> teacher, A's owner M and listeners S1, M2; not S2 or the author.
select t.login('N');
select t.lives(t.pdf('N', 'f3', 'Answers.pdf', 'A', true), 'N adds a course-only PDF on A');
reset role;
select t.eq(t.calls(), 4::bigint, 'AC9 one call');
select t.eq(t.recipients('file', t.mid('f3')), 'Mentor Nina|Answers.pdf: M,M2,S1,T',
  'AC3 course-only: teacher, owner and listeners only; non-listener S2 left out; P and R left out');
-- A course-only PDF by the owner: the owner is the author, so left out.
select t.login('M');
select t.lives(t.pdf('M', 'f4', 'Quiz.pdf', 'A', true), 'M adds a course-only PDF on A');
reset role;
select t.eq(t.recipients('file', t.mid('f4')), 'Mentor Max|Quiz.pdf: M2,S1,T', 'AC3/AC4 owner as author left out');
-- Owner changes before processing -> the current owner.
update courses set created_by = t.id('N') where id = t.id('A');
select t.eq(t.recipients('file', t.mid('f4')), 'Mentor Max|Quiz.pdf: M2,N,S1,T', 'recipients are computed at processing time');
update courses set created_by = t.id('M') where id = t.id('A');
-- The course is deleted -> "on delete set null" leaves course_only on with no course: visible to everyone, and so are
-- its messages. (Course A has homework, which can't be deleted here, so set the column as the delete would.)
update material_files set course_id = null where id = t.mid('f3');
select t.eq(t.recipients('file', t.mid('f3')), 'Mentor Nina|Answers.pdf: M,M2,S1,S2,T',
  'AC3 course-only PDF whose course is gone: everyone but the author');

-- AC 6: edits (name, description, course, course-only) and deletes -> no call.
select t.login('M');
select t.lives(format('update material_files set name = %L, description = %L, course_id = %L where id = %L',
  'Renamed.pdf', 'New text', t.id('B'), t.mid('f1')), 'M edits a PDF');
reset role;
update material_files set course_only = true where id = t.mid('f1');
select t.login('M');
select t.lives(format('delete from material_files where id = %L', t.mid('f2')), 'M deletes a PDF');
select t.lives(format('delete from materials where id = %L', t.mid('b3')), 'M deletes a post');
reset role;
select t.eq(t.calls(), 5::bigint, 'AC6 edits and deletes: no call (the 5th is f4)');

-- AC 6: rejected inserts -> no call.
select t.login('S1');
select t.throws(t.blog('S1', 'x1', 'Student post'), '42501', 'AC6 a student can''t share a post');
select t.throws(t.pdf('S1', 'x2', 'Student.pdf', null, false), '42501', 'AC6 a student can''t add a PDF');
select t.login('M');
select t.throws(t.blog('M', 'x3', '   '), '23514', 'AC6 an empty title is refused');
select t.throws(t.pdf('M', 'x4', '', null, false), '23514', 'AC6 an empty file name is refused');
reset role;
select t.eq(t.calls(), 5::bigint, 'AC6 rejected inserts: no call');

-- AC 7: deleted before processing -> nothing.
select t.eq(t.recipients('blog', t.mid('b3')), '', 'AC7 deleted post: nothing');
select t.eq(t.recipients('file', t.mid('f2')), '', 'AC7 deleted PDF: nothing');

-- Edge: the author renamed before processing -> the current name; titles are returned as typed.
update profiles set full_name = 'Max *Bold* <b>' where id = t.id('M');
select t.eq(t.recipients('blog', t.mid('b1')), 'Max *Bold* <b>|Exam tips: M2,N,S1,S2,T', 'current author name, as typed');

-- AC 8: net.http_post raising -> the insert still succeeds.
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language plpgsql as $$ begin raise exception 'pg_net is down'; end $$;
select t.login('M');
select t.lives(t.blog('M', 'b4', 'Still saved'), 'AC8 http_post raising: the post is still saved');
select t.lives(t.pdf('M', 'f5', 'Still.pdf', null, false), 'AC8 http_post raising: the PDF is still saved');
reset role;
select t.ok(exists (select 1 from materials where id = t.mid('b4')) and exists (select 1 from material_files where id = t.mid('f5')),
  'AC8 both rows exist');

-- AC 8: pg_net not installed -> still succeeds.
drop function net.http_post(text, jsonb, jsonb, jsonb, integer);
select t.login('T');
select t.lives(t.blog('T', 'b5', 'No pg_net'), 'AC8 no pg_net: the post is still saved');
select t.lives(t.pdf('T', 'f6', 'NoNet.pdf', null, false), 'AC8 no pg_net: the PDF is still saved');
reset role;

select t.ok(not exists (select 1 from pg_policies where policyname ilike '%new material%'), 'no new RLS policy');
