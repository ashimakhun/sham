-- ARU-75: deleting an account (migration 0040). The Edge Function deletes the Auth user with the service role; here
-- that is `delete from auth.users` as the admin, which is what Supabase Auth runs.
-- M2 (mentor, owns nothing) is the account deleted: he wrote in the chats, checked homework, created a meeting with
-- notes and homework, added a listener, selected a paid course, and has personal rows of every kind.
select t.seed();

create function t.x(name text) returns uuid language sql immutable as $$ select md5('aru75-' || name)::uuid $$;
grant execute on function t.x(text) to anon, authenticated;

-- The foreign key on tbl.col to profiles: its on-delete action ('n' set null, 'c' cascade, 'a' no action).
create function t.fk_action(tbl text, col text) returns "char" language sql stable as $$
  select c.confdeltype
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.conrelid = ('public.' || tbl)::regclass and c.confrelid = 'public.profiles'::regclass
    and a.attname = col
$$;
create function t.nullable(tbl text, col text) returns boolean language sql stable as $$
  select is_nullable = 'YES' from information_schema.columns
  where table_schema = 'public' and table_name = tbl and column_name = col
$$;
-- The error message of a statement, or null when it succeeds.
create function t.err(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- Migration shape ---------------------------------------------------------------------------------------------------
select t.eq(t.fk_action(tbl, col), 'n'::"char", tbl || '.' || col || ' is on delete set null')
from (values ('profiles', 'mentor_id'), ('homework', 'checked_by'), ('course_members', 'added_by'),
  ('course_messages', 'author_id'), ('general_messages', 'author_id'), ('course_meetings', 'created_by'),
  ('course_meetings', 'status_changed_by'), ('course_meetings', 'notes_updated_by'),
  ('course_meetings', 'homework_checked_by'), ('homework_assignments', 'created_by'), ('course_billing', 'selected_by'),
  ('disciplines', 'created_by'), ('profiles', 'access_changed_by')) as v (tbl, col);
select t.ok(t.nullable(tbl, col), tbl || '.' || col || ' is nullable')
from (values ('course_members', 'added_by'), ('course_messages', 'author_id'), ('general_messages', 'author_id'),
  ('course_meetings', 'created_by'), ('homework_assignments', 'created_by'), ('course_billing', 'selected_by'),
  ('disciplines', 'created_by')) as v (tbl, col);
select t.eq(t.fk_action(tbl, col), 'c'::"char", tbl || '.' || col || ' still cascades (personal data)')
from (values ('homework', 'student_id'), ('course_members', 'user_id'), ('meeting_attendance', 'user_id'),
  ('course_feedback', 'user_id'), ('material_likes', 'user_id'), ('materials', 'teacher_id'),
  ('material_files', 'author_id'), ('course_chat_reads', 'user_id'), ('general_chat_reads', 'user_id'),
  ('telegram_links', 'user_id'), ('telegram_link_codes', 'user_id')) as v (tbl, col);
select t.eq(t.fk_action('courses', 'created_by'), 'a'::"char", 'AC6 courses.created_by still blocks the deletion');

-- Fixture -----------------------------------------------------------------------------------------------------------
-- As the admin without triggers (like t.make_assignments), so rows can be set up as they would be after months of use.
set session_replication_role = replica;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M2')),   -- listener added by M2
  (t.id('B'), t.id('M2'), t.id('N'));    -- M2 is a listener of B
update profiles set mentor_id = t.id('M2') where id = t.id('S2');
update profiles set access_changed_by = t.id('M2') where id = t.id('S3');
update profiles set is_accountant = true where id = t.id('M2');
insert into course_messages (id, course_id, author_id, body, created_at) values
  (t.x('cm_old'), t.id('A'), t.id('M2'), 'from M2', now() - interval '3 hours'),
  (t.x('cm_new'), t.id('A'), t.id('S2'), 'from S2', now() - interval '1 hour');
insert into general_messages (id, author_id, body, created_at) values
  (t.x('gm'), t.id('M2'), 'hello all', now() - interval '2 hours');
update homework set status = 'checked', checked_by = t.id('M2'), checked_at = now(), mentor_comment = 'Nice'
  where id = t.id('HW_A1');
insert into course_meetings (id, course_id, starts_at, topic, status, created_by, status_changed_by, status_changed_at,
    notes, notes_updated_by, notes_updated_at, homework_checked_at, homework_checked_by) values
  (t.x('mtg'), t.id('A'), now() - interval '1 day', 'Week 1', 'completed', t.id('M2'), t.id('M2'), now(),
    'Read chapter 1', t.id('M2'), now(), now(), t.id('M2')),
  (t.x('mtgB'), t.id('B'), now() - interval '1 day', 'Week 1', 'completed', t.id('N'), t.id('N'), now(),
    null, null, null, null, null);
insert into homework_assignments (id, meeting_id, course_id, title, created_by) values
  (t.x('asg'), t.x('mtg'), t.id('A'), 'Exercises', t.id('M2')),
  (t.x('asgB'), t.x('mtgB'), t.id('B'), 'Lab', t.id('N'));
insert into course_billing (course_id, start_day, end_day, selected_by) values (t.id('A'), 1, 10, t.id('M2'));
insert into disciplines (id, name, created_by) values (t.x('disc'), 'Maths', t.id('M2'));
-- M2's personal rows.
insert into homework (id, student_id, course_id, assignment_id, title, photo_path) values
  (t.x('hw'), t.id('M2'), t.id('B'), t.x('asgB'), 'Lab report', t.id('M2') || '/' || t.x('hw') || '.jpg');
insert into meeting_attendance (meeting_id, user_id) values (t.x('mtgB'), t.id('M2'));
insert into course_feedback (id, course_id, user_id, rating, body) values (t.x('fb'), t.id('B'), t.id('M2'), 2, 'Meh');
insert into course_feedback (id, course_id, user_id, rating, body) values (t.x('fb2'), t.id('B'), t.id('S1'), 4, 'Good');
insert into materials (id, teacher_id, title, body) values
  (t.x('post'), t.id('M2'), 'My post', 'text'),
  (t.x('tpost'), t.id('T'), 'Teacher post', 'text');
insert into material_likes (material_id, user_id) values (t.x('post'), t.id('S1')), (t.x('tpost'), t.id('M2'));
insert into material_files (id, author_id, name, course_id, storage_path, size_bytes) values
  (t.x('pdf'), t.id('M2'), 'Book', t.id('A'), t.id('M2') || '/' || t.x('pdf') || '.pdf', 1000);
insert into course_chat_reads (course_id, user_id, last_read_at) values (t.id('B'), t.id('M2'), now());
insert into general_chat_reads (user_id, last_read_at) values (t.id('M2'), now());
insert into telegram_links (user_id, chat_id) values (t.id('M2'), 4242);
insert into telegram_link_codes (code, user_id) values ('aru75code', t.id('M2'));
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.id('M2') || '/' || t.x('hw') || '.jpg', t.id('M2')),
  ('materials', t.id('M2') || '/' || t.x('pdf') || '.pdf', t.id('M2')),
  ('materials', t.id('M2') || '/orphan.pdf', null);           -- in M2's folder, no owner recorded
set session_replication_role = origin;

-- AC 6 / teacher: account_deletion_problem() -----------------------------------------------------------------------
select t.eq(account_deletion_problem(t.id('M2')), null::text, 'AC6 a mentor who owns nothing can be deleted');
select t.eq(account_deletion_problem(t.id('S1')), null::text, 'a student can be deleted');
select t.eq(account_deletion_problem(t.id('M')),
  'You own courses: Algebra. Ask the teacher or a mentor to change their owner first.',
  'AC6 a course owner is refused with the course list');
insert into courses (id, title, created_by) values (t.x('c2'), 'Zoology', t.id('M'));
select t.eq(account_deletion_problem(t.id('M')),
  'You own courses: Algebra, Zoology. Ask the teacher or a mentor to change their owner first.',
  'AC6 every owned course, A-Z');
select t.eq(account_deletion_problem(t.id('T')), 'The teacher''s account can''t be deleted.', 'the teacher is refused');

-- Only the service role (the Edge Function) may call the helpers.
select t.login('S1');
select t.throws($$select account_deletion_problem(auth.uid())$$, '42501', 'app users can''t call account_deletion_problem()');
select t.throws($$select * from account_storage_objects(auth.uid())$$, '42501', 'app users can''t call account_storage_objects()');
reset role;
select t.ok(has_function_privilege('service_role', 'account_deletion_problem(uuid)', 'execute')
  and has_function_privilege('service_role', 'account_storage_objects(uuid)', 'execute'),
  'the service role (the Edge Function) may call both');
select t.eq((select count(*) from account_storage_objects(t.id('M2'))), 3::bigint,
  'AC12b every file of the account is listed (owned, or in its own folder)');
select t.eq((select array_agg(bucket_id || ':' || name order by bucket_id, name) from account_storage_objects(t.id('S1'))),
  array['homework:' || t.id('S1') || '/a1.jpg', 'homework:' || t.id('S1') || '/b1.jpg'],
  'AC12b only the account''s own files');

-- The database refuses too (AC 6, teacher): nothing is deleted.
select t.eq(t.err(format('delete from auth.users where id = %L', t.id('M'))),
  'You own courses: Algebra, Zoology. Ask the teacher or a mentor to change their owner first.',
  'AC6 deleting a course owner''s Auth user fails with the course list');
select t.ok(exists (select 1 from profiles where id = t.id('M')), 'AC6 the owner''s profile is still there');
select t.eq(t.err(format('delete from auth.users where id = %L', t.id('T'))), 'The teacher''s account can''t be deleted.',
  'deleting the teacher''s Auth user fails');
select t.ok(exists (select 1 from auth.users where id = t.id('T')), 'the teacher is still there');

-- Null-safe counters before the deletion (baseline): S1 in A sees 2 unread course messages, 1 in the general chat.
select t.login('S1');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 2::bigint, 'baseline course unread');
select t.eq(general_chat_unread_count(), 1::bigint, 'baseline general unread');
reset role;

-- AC 12 c: the deletion, in one statement (one transaction) -----------------------------------------------------------
select t.lives(format('delete from auth.users where id = %L', t.id('M2')), 'AC4 M2''s Auth user is deleted');

-- AC 7: personal data is gone.
select t.ok(not exists (select 1 from profiles where id = t.id('M2')), 'AC7 profile gone');
select t.ok(not exists (select 1 from homework where student_id = t.id('M2')), 'AC7 own homework gone');
select t.ok(not exists (select 1 from course_members where user_id = t.id('M2')), 'AC7 memberships gone');
select t.ok(not exists (select 1 from meeting_attendance where user_id = t.id('M2')), 'AC7 attendance gone');
select t.ok(not exists (select 1 from course_feedback where user_id = t.id('M2')), 'AC7 feedback gone');
select t.eq((select avg(rating)::numeric from course_feedback where course_id = t.id('B')), 4::numeric,
  'AC7 the course average is recalculated without it');
select t.ok(not exists (select 1 from material_likes where user_id = t.id('M2')), 'AC7 own likes gone');
select t.ok(not exists (select 1 from materials where id = t.x('post')), 'AC7 Blog post gone (with its likes)');
select t.ok(not exists (select 1 from material_likes where material_id = t.x('post')), 'AC7 likes on the post gone');
select t.ok(not exists (select 1 from material_files where author_id = t.id('M2')), 'AC7 Knowledge base PDFs gone');
select t.ok(not exists (select 1 from course_chat_reads where user_id = t.id('M2')), 'AC7 course chat read positions gone');
select t.ok(not exists (select 1 from general_chat_reads where user_id = t.id('M2')), 'AC7 general chat read position gone');
select t.ok(not exists (select 1 from telegram_links where user_id = t.id('M2')), 'AC7 Telegram link gone');
select t.ok(not exists (select 1 from telegram_link_codes where user_id = t.id('M2')), 'AC7 Telegram link codes gone');

-- AC 8: shared content stays, pointing to no one.
select t.ok((select author_id is null and body = 'from M2' from course_messages where id = t.x('cm_old')),
  'AC8 course chat message kept, author null');
select t.ok((select author_id is null and body = 'hello all' from general_messages where id = t.x('gm')),
  'AC8 general chat message kept, author null');
select t.ok((select status = 'checked' and mentor_comment = 'Nice' and checked_by is null and checked_at is not null
  from homework where id = t.id('HW_A1')), 'AC8 checked homework keeps comment and status, checker null');
select t.ok((select created_by is null and status_changed_by is null and notes_updated_by is null
    and homework_checked_by is null and notes = 'Read chapter 1' and homework_checked_at is not null
  from course_meetings where id = t.x('mtg')), 'AC8 meeting, notes and "homework checked" kept, people null');
select t.ok((select created_by is null and title = 'Exercises' from homework_assignments where id = t.x('asg')),
  'AC8 homework assignment kept, creator null');
select t.ok((select added_by is null from course_members where course_id = t.id('A') and user_id = t.id('S2')),
  'AC8 listener addition kept, adder null');
select t.ok((select selected_by is null and end_day = 10 from course_billing where course_id = t.id('A')),
  'AC8 paid-course selection kept, selector null');
select t.ok((select created_by is null from disciplines where id = t.x('disc')), 'discipline kept, creator null');
select t.ok((select mentor_id is null from profiles where id = t.id('S2')), 'profiles.mentor_id cleared');
select t.ok((select access_changed_by is null from profiles where id = t.id('S3')), 'profiles.access_changed_by cleared');
select t.eq((select count(*) from homework where student_id = t.id('S1')), 3::bigint, 'AC8 other people''s homework untouched');

-- Analysis note 1: null authors still count, and rule (d) still sees them.
select t.login('S1');
select t.eq((select unread from chat_unread_counts() where course_id = t.id('A')), 2::bigint,
  'note 1 (0016) a deleted author''s unread course message still counts');
select t.eq(general_chat_unread_count(), 1::bigint, 'note 1 (0034) a deleted author''s unread general message still counts');
-- RLS: clients still can't write a null author / actor.
select t.throws(format($$insert into course_messages (course_id, author_id, body) values (%L, null, 'x')$$, t.id('A')),
  '42501', 'RLS: a client can''t post a course message without an author');
select t.throws($$insert into general_messages (author_id, body) values (null, 'x')$$, '42501',
  'RLS: a client can''t post a general message without an author');
-- The deleted user's still-valid token can't do anything (AC 9).
select t.login('M2');
select t.eq((select count(*) from course_messages), 0::bigint, 'AC9 a deleted user''s token reads no course messages');
select t.eq((select count(*) from general_messages), 0::bigint, 'AC9 ... no general messages');
select t.eq((select count(*) from homework), 0::bigint, 'AC9 ... no homework');
select t.throws($$insert into general_messages (author_id, body) values (auth.uid(), 'ghost')$$, '42501',
  'AC9 ... can''t post in the general chat');
select t.throws(format($$insert into storage.objects (bucket_id, name, owner) values ('homework', %L, auth.uid())$$,
  t.id('M2') || '/late.jpg'), '42501', 'AC9 ... can''t upload a homework photo');
select t.throws(format($$insert into storage.objects (bucket_id, name, owner) values ('materials', %L, auth.uid())$$,
  t.id('M2') || '/late.pdf'), '42501', 'AC9 ... can''t upload a PDF');
reset role;

-- S1 has no read position in A: cm_old (deleted author) is the oldest unread, so cm_new isn't a new batch for S1.
select t.ok((select not (t.id('S1') = any (recipient_ids)) from chat_message_recipients(t.x('cm_new'))),
  'note 1 (0036) no second Telegram message for a batch that starts with a deleted author''s message');
select t.ok((select t.id('S1') = any (recipient_ids) from chat_message_recipients(t.x('cm_old'))),
  'note 1 (0036) a deleted author''s message still has recipients');
select t.eq((select array_agg(user_id order by user_id) from new_homework_recipients(t.x('asg'))),
  array[t.id('S1'), t.id('S2')], '0038 an assignment by a deleted mentor still reaches the listeners');

-- AC 5: signing up again with the same email is a brand-new waiting student with none of the old data.
insert into auth.users (id, email, raw_user_meta_data) values (t.x('again'), 'm2@x.test', '{"full_name":"Mentor Mo"}');
select t.ok((select role = 'student' and access_status = 'pending' and mentor_id is null and not is_accountant
  from profiles where id = t.x('again')), 'AC5 a new account with the same email waits as a student');
select t.ok(not exists (select 1 from course_members where user_id = t.x('again'))
  and not exists (select 1 from telegram_links where user_id = t.x('again')), 'AC5 with none of the old data');

-- AC 10: a waiting account can be deleted, and leaves the teacher's Requests list.
select t.lives(format('delete from auth.users where id = %L', t.x('again')), 'AC10 a waiting account is deleted');
select t.login('T');
select t.ok(not exists (select 1 from access_requests() where id = t.x('again')), 'AC10 gone from Requests');
reset role;

-- AC 12 c is all-or-nothing: a failure inside the deletion leaves every row as it was.
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
create trigger boom before delete on telegram_links for each row execute function pg_temp.boom();
insert into telegram_links (user_id, chat_id) values (t.id('S1'), 777);
select t.eq(t.err(format('delete from auth.users where id = %L', t.id('S1'))), 'boom', 'AC12c a failing step fails the deletion');
select t.ok(exists (select 1 from profiles where id = t.id('S1'))
  and (select count(*) from homework where student_id = t.id('S1')) = 3
  and exists (select 1 from course_members where user_id = t.id('S1')), 'AC12c ... and nothing was deleted');
drop trigger boom on telegram_links;
select t.lives(format('delete from auth.users where id = %L', t.id('S1')), 'AC12c retry deletes S1');
select t.ok(not exists (select 1 from homework where student_id = t.id('S1')), 'AC7 S1''s homework gone');
select t.eq((select count(*) from course_members where course_id = t.id('A')), 1::bigint,
  'AC7 S1 left course A''s listeners (count drops)');
