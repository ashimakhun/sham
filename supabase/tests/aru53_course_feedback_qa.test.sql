-- QA ARU-53: gaps in aru53_course_feedback.test.sql: removal through the app's remove_listener(), a mentor who owns one
-- course and listens to another, hidden-course listeners losing read access when removed, the length limit counted
-- in characters (not bytes), and that marking a meeting completed opens feedback.
-- Course A: owner M, listeners S1 and M2. Course B: owner M2 (a mentor who listens to A), listener S2. Hidden H:
-- owner M, listener S3.
select t.seed();
update courses set created_by = t.id('M2') where id = t.id('B');
insert into courses (id, title, created_by, hidden) values ('00000000-0000-0000-0000-00000053c0a1', 'Secret', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('B'), t.id('S2'), t.id('M2')), ('00000000-0000-0000-0000-00000053c0a1', t.id('S3'), t.id('M'));
set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  ('00000000-0000-0000-0000-00000053c0b1', t.id('A'), now() - interval '1 day', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000053c0b2', t.id('B'), now() - interval '1 hour', 'scheduled', t.id('M2')),
  ('00000000-0000-0000-0000-00000053c0b3', '00000000-0000-0000-0000-00000053c0a1', now() - interval '1 day', 'completed', t.id('M'));
set session_replication_role = origin;
create function t.h() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000053c0a1'::uuid $$;
grant execute on function t.h() to anon, authenticated;

-- Edge case: M2 listens to A and owns B: writes only on A.
select t.login('M2');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 4, 'As a listener')$$, 'edge: M2 rates A');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 5, 'My own course')$$, '42501',
  'edge: but not B, which M2 owns');

-- AC 1: B opens for feedback as soon as its owner marks the started meeting completed.
select t.login('S2');
select t.throws($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 4, 'Too early')$$, '42501',
  'AC1 S2 can''t rate B before a completed meeting');
select t.login('M2');
select t.lives($$select set_meeting_status('00000000-0000-0000-0000-00000053c0b2', 'completed')$$, 'AC1 M2 completes B''s meeting');
select t.login('S2');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.id('B'), 4, 'Now open')$$, 'AC1 now S2 can rate B');

-- AC 2: the limit is 1000 characters, not bytes (Cyrillic or emoji text is fine up to 1000 characters).
select t.login('S1');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.id('A'), 5, repeat('ж', 999) || '🎉')$$,
  'AC2 1000 multi-byte characters are accepted');
select t.eq((select char_length(body) from course_feedback where user_id = auth.uid()), 1000, 'AC2 stored as 1000 characters');
select t.throws($$update course_feedback set body = repeat('🎉', 1001) where user_id = auth.uid()$$, '23514',
  'AC2 an edit to 1001 characters is refused');
select t.throws($$update course_feedback set body = E'  \n\t ' where user_id = auth.uid()$$, '23514',
  'AC2 an edit to whitespace only is refused');
select t.eq(t.affected($$update course_feedback set rating = 2 where user_id = auth.uid()$$), 1::bigint, 'AC4 changing only the stars works');

-- AC 9 through the app's path: remove_listener() keeps the feedback (it deletes homework, not feedback).
select t.login('M');
select t.lives($$select remove_listener(t.id('A'), t.id('S1'))$$, 'AC9 the owner removes S1 with remove_listener()');
reset role;
select t.ok(exists (select 1 from course_feedback where course_id = t.id('A') and user_id = t.id('S1')), 'AC9 S1''s feedback stays');
select t.login('S1');
select t.eq(t.affected($$update course_feedback set rating = 1 where user_id = auth.uid()$$), 0::bigint, 'AC9 S1 can''t edit it');
select t.ok((select rating from course_feedback where user_id = auth.uid() and course_id = t.id('A')) = 2, 'AC9 and still reads it (A is visible)');

-- AC 7 hidden: H's listener writes and reads; once removed they read nothing of H's feedback.
select t.login('S3');
select t.lives($$insert into course_feedback (course_id, rating, body) values (t.h(), 5, 'Secret course is good')$$, 'AC7 H''s listener rates H');
select t.login('M');
select t.lives($$select remove_listener(t.h(), t.id('S3'))$$, 'the owner removes S3 from H');
select t.login('S3');
select t.eq((select count(*) from course_feedback where course_id = t.h()), 0::bigint,
  'AC7 a removed listener of a hidden course no longer reads its feedback, even their own');
select t.login('T');
select t.eq((select count(*) from course_feedback where course_id = t.h()), 1::bigint, 'AC7 the teacher still does');
select t.login('M2');
select t.eq((select count(*) from course_feedback where course_id = t.h()), 0::bigint, 'AC7 a non-participant mentor doesn''t');
reset role;
