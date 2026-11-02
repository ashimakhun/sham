-- ARU-53: listeners rate a started course. Rules under test: supabase/migrations/0025_course_feedback.sql.
-- Fixture (t.seed): teacher T; course A owned by mentor M, course B owned by mentor N.
-- Here: A has listeners S1 (student) and M2 (mentor) and a completed meeting (started). B has listener S2 and only a
-- scheduled meeting (not started); later B is made hidden. S3 and N are not listeners of A. P is pending, R rejected.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('M2'), t.id('M')), (t.id('B'), t.id('S2'), t.id('N'));
set session_replication_role = replica;
insert into course_meetings (course_id, starts_at, status, created_by) values
  (t.id('A'), now() - interval '1 day', 'completed', t.id('M')),
  (t.id('B'), now() + interval '1 day', 'scheduled', t.id('N')),
  (t.id('B'), now() - interval '2 days', 'canceled', t.id('N'));
set session_replication_role = origin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000053b1', 'p@x.test', '{"full_name":"Pending Pat"}'),
  ('00000000-0000-0000-0000-0000000053b2', 'r@x.test', '{"full_name":"Rejected Rae"}');
update profiles set access_status = 'rejected' where id = '00000000-0000-0000-0000-0000000053b2';

create function t.login_new(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.login_new(uuid) to anon, authenticated;

-- Data checks.
select t.ok((select relrowsecurity from pg_class where oid = 'public.course_feedback'::regclass), 'data: RLS on');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_feedback'),
  'AC11 data: feedback is in realtime');
select t.ok(not has_function_privilege('anon', 'course_started(uuid)', 'execute'), 'data: anon cannot call course_started');
select t.ok(course_started(t.id('A')) and not course_started(t.id('B')), 'AC1 data: A started, B (scheduled + canceled) not');

-- AC 1 / AC 2: listeners add feedback once the course has started; the text is trimmed; times are the server's.
select t.login('S1');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 5, '  Great course!  ')$$,
  'AC2 a student listener adds feedback to a started course');
select t.eq((select body from course_feedback where user_id = auth.uid()), 'Great course!', 'AC2 the text is stored trimmed');
select t.ok((select updated_at = created_at from course_feedback where user_id = auth.uid()), 'AC4 a new feedback is not "edited"');
select t.login('M2');
select t.lives($$insert into course_feedback (course_id, user_id, rating, body) values (t.id('A'), auth.uid(), 3, 'Okay')$$,
  'AC2 a mentor listener adds feedback');
select t.login('S2');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 4, 'Early')$$, '42501',
  'AC1 no feedback before the first completed meeting (canceled does not count)');

-- AC 2: validation.
select t.login('S1');
select t.throws($$update course_feedback set rating = 0 where user_id = auth.uid()$$, '23514', 'AC2 0 stars refused');
select t.throws($$update course_feedback set rating = 6 where user_id = auth.uid()$$, '23514', 'AC2 6 stars refused');
select t.throws($$update course_feedback set body = '   ' where user_id = auth.uid()$$, '23514', 'AC2 whitespace-only text refused');
select t.throws($$update course_feedback set body = repeat('x', 1001) where user_id = auth.uid()$$, '23514', 'AC2 1001 characters refused');
select t.lives($$update course_feedback set body = repeat('x', 1000) where user_id = auth.uid()$$, 'AC2 1000 characters accepted');

-- AC 3: one per listener and course.
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 4, 'Again')$$, '23505',
  'AC3 a second feedback is refused');

-- AC 4: edit; created_at kept, updated_at moves; only rating and body can change.
reset role;
set session_replication_role = replica; -- backdate without the trigger
update course_feedback set created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour'
  where user_id = t.id('S1');
set session_replication_role = origin;
select t.login('S1');
select t.eq(t.affected($$update course_feedback set rating = 4, body = 'Good, edited' where user_id = auth.uid()$$), 1::bigint,
  'AC4 the author edits their feedback');
select t.ok((select updated_at > created_at and created_at < now() - interval '59 minutes' from course_feedback
  where user_id = auth.uid()), 'AC4 updated_at moves, created_at stays');
select t.throws($$update course_feedback set course_id = t.id('B') where user_id = auth.uid()$$, '42501', 'AC6 course can''t change');
select t.throws($$update course_feedback set user_id = t.id('S3') where user_id = auth.uid()$$, '42501', 'AC6 author can''t change');
select t.throws($$update course_feedback set created_at = now() where user_id = auth.uid()$$, '42501', 'AC4 created_at can''t change');
select t.throws($$insert into course_feedback (course_id, rating, body, created_at) values (t.id('A'), 4, 'x', now())$$, '42501',
  'AC4 created_at can''t be given');

-- AC 6: nobody else writes.
select t.eq(t.affected($$update course_feedback set rating = 1 where user_id = t.id('M2')$$), 0::bigint,
  'AC6 a listener can''t edit someone else''s feedback');
select t.eq(t.affected($$delete from course_feedback where user_id = t.id('M2')$$), 0::bigint,
  'AC6 a listener can''t delete someone else''s feedback');
select t.throws($$insert into course_feedback (course_id, user_id, rating, body) values (t.id('A'), t.id('S3'), 2, 'Fake')$$,
  '42501', 'AC6 a listener can''t write as someone else');
select t.login('M');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 5, 'Mine')$$, '42501', 'AC6 the owner can''t add');
select t.eq(t.affected($$update course_feedback set rating = 1 where true$$), 0::bigint, 'AC6 the owner can''t edit');
select t.eq(t.affected($$delete from course_feedback where true$$), 0::bigint, 'AC6 the owner can''t delete');
select t.login('T');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 5, 'Teach')$$, '42501', 'AC6 the teacher can''t add');
select t.eq(t.affected($$update course_feedback set rating = 1 where true$$), 0::bigint, 'AC6 the teacher can''t edit');
select t.eq(t.affected($$delete from course_feedback where true$$), 0::bigint, 'AC6 the teacher can''t delete');
select t.login('S3');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 5, 'Hi')$$, '42501', 'AC6 a non-listener student can''t add');
select t.login('N');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 5, 'Hi')$$, '42501', 'AC6 a non-listener mentor can''t add');

-- AC 7: every approved user reads feedback of a visible course.
select t.login('S3');
select t.eq((select count(*) from course_feedback where course_id = t.id('A')), 2::bigint, 'AC7 a non-member student reads it');
select t.login('N');
select t.eq((select count(*) from course_feedback where course_id = t.id('A')), 2::bigint, 'AC7 a non-member mentor reads it');
select t.login('T');
select t.eq((select count(*) from course_feedback), 2::bigint, 'AC7 the teacher reads it');

-- AC 7: hidden courses. B gets a completed meeting and S2's feedback, then becomes hidden.
reset role;
set session_replication_role = replica;
insert into course_meetings (course_id, starts_at, status, created_by) values (t.id('B'), now() - interval '1 hour', 'completed', t.id('N'));
set session_replication_role = origin;
select t.login('S2');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 2, 'Hard')$$,
  'AC1 feedback opens once a meeting is completed');
reset role;
update courses set hidden = true where id = t.id('B');
select t.login('S2');
select t.eq((select count(*) from course_feedback where course_id = t.id('B')), 1::bigint, 'AC7 hidden: a listener reads it');
select t.login('N');
select t.eq((select count(*) from course_feedback where course_id = t.id('B')), 1::bigint, 'AC7 hidden: the owner reads it');
select t.login('T');
select t.eq((select count(*) from course_feedback where course_id = t.id('B')), 1::bigint, 'AC7 hidden: the teacher reads it');
select t.login('S1');
select t.eq((select count(*) from course_feedback where course_id = t.id('B')), 0::bigint, 'AC7 hidden: a non-member student reads nothing');
select t.login('M');
select t.eq((select count(*) from course_feedback where course_id = t.id('B')), 0::bigint, 'AC7 hidden: a non-member mentor reads nothing');

-- AC 10: pending, rejected and anon accounts read and write nothing.
reset role;
select t.login_new('00000000-0000-0000-0000-0000000053b1');
select t.eq((select count(*) from course_feedback), 0::bigint, 'AC10 a pending account reads nothing');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 5, 'x')$$, '42501', 'AC10 a pending account can''t add');
reset role;
select t.login_new('00000000-0000-0000-0000-0000000053b2');
select t.eq((select count(*) from course_feedback), 0::bigint, 'AC10 a rejected account reads nothing');
reset role;
select t.login(null);
select t.eq((select count(*) from course_feedback), 0::bigint, 'AC10 anon reads nothing');
select t.throws($$insert into course_feedback (course_id, user_id, rating, body) values (t.id('A'), t.id('S1'), 5, 'x')$$, '42501',
  'AC10 anon can''t add');

-- AC 9: a removed listener's feedback stays visible but is locked; re-added, they can edit again.
reset role;
delete from course_members where course_id = t.id('A') and user_id = t.id('M2');
select t.login('S3');
select t.ok(exists (select 1 from course_feedback where user_id = t.id('M2')), 'AC9 the removed listener''s feedback stays visible');
select t.login('M2');
select t.eq(t.affected($$update course_feedback set rating = 5 where user_id = auth.uid()$$), 0::bigint, 'AC9 a removed listener can''t edit');
select t.eq(t.affected($$delete from course_feedback where user_id = auth.uid()$$), 0::bigint, 'AC9 a removed listener can''t delete');
reset role;
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('M2'), t.id('M'));
select t.login('M2');
select t.eq(t.affected($$update course_feedback set rating = 5 where user_id = auth.uid()$$), 1::bigint, 'AC9 re-added, they can edit again');

-- AC 5: delete own; then add again.
select t.login('S1');
select t.eq(t.affected($$delete from course_feedback where user_id = auth.uid()$$), 1::bigint, 'AC5 the author deletes their feedback');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 4, 'Back')$$, 'AC5 and can add a new one');

-- Cascades: deleting a profile or a course removes its feedback.
reset role;
delete from auth.users where id = t.id('S2');
select t.eq((select count(*) from course_feedback where course_id = t.id('B')), 0::bigint, 'a deleted account''s feedback goes with it');
delete from homework where course_id = t.id('A'); -- homework blocks deleting a course
delete from courses where id = t.id('A');
select t.eq((select count(*) from course_feedback), 0::bigint, 'a deleted course''s feedback goes with it');
